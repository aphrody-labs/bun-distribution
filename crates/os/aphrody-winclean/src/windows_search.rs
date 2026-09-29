// SPDX-License-Identifier: Apache-2.0
//! Windows Search bridge.
//!
//! The Windows Search OLE DB provider is exposed through ADO on Windows.  The
//! `windows` crate does not expose the ADO type library, so this module keeps
//! the small Automation ABI surface local instead of spawning PowerShell (or
//! while preserving the frozen compatibility contract.

#![cfg(windows)]

use std::{ffi::c_void, ptr};

use serde_json::Value;

type Hresult = i32;

#[repr(C)]
#[derive(Clone, Copy)]
struct Guid {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const IID_NULL: Guid = Guid { data1: 0, data2: 0, data3: 0, data4: [0; 8] };
const CLSID_ADODB_CONNECTION: Guid = Guid {
    data1: 0x00000514,
    data2: 0,
    data3: 0x0010,
    data4: [0x80, 0, 0, 0xaa, 0, 0x6d, 0x2e, 0xa4],
};
const IID_IDISPATCH: Guid =
    Guid { data1: 0x00020400, data2: 0, data3: 0, data4: [0xc0, 0, 0, 0, 0, 0, 0, 0x46] };

const CLSCTX_INPROC_SERVER: u32 = 1;
const COINIT_APARTMENTTHREADED: u32 = 2;
const DISPATCH_METHOD: u16 = 1;
const DISPATCH_PROPERTYGET: u16 = 2;
const VT_EMPTY: u16 = 0;
const VT_I4: u16 = 3;
const VT_BOOL: u16 = 11;
const VT_ERROR: u16 = 10;
const VT_BSTR: u16 = 8;
const VT_DISPATCH: u16 = 9;
const DISP_E_PARAMNOTFOUND: i32 = -2147352572;

#[repr(C)]
union VariantData {
    i16: i16,
    i32: i32,
    bstr: *mut u16,
    dispatch: *mut IDispatch,
}

#[repr(C)]
struct Variant {
    vt: u16,
    reserved1: u16,
    reserved2: u16,
    reserved3: u16,
    data: VariantData,
    reserved: u64,
}

impl Variant {
    fn empty() -> Self {
        Self {
            vt: VT_EMPTY,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            data: VariantData { i32: 0 },
            reserved: 0,
        }
    }

    fn missing() -> Self {
        Self {
            vt: VT_ERROR,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            data: VariantData { i32: DISP_E_PARAMNOTFOUND },
            reserved: 0,
        }
    }

    fn i4(value: i32) -> Self {
        Self {
            vt: VT_I4,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            data: VariantData { i32: value },
            reserved: 0,
        }
    }

    fn bstr(value: &str) -> Result<Self, String> {
        let utf16: Vec<u16> = value.encode_utf16().collect();
        // SAFETY: `SysAllocStringLen` copies exactly `utf16.len()` elements.
        let bstr = unsafe { SysAllocStringLen(utf16.as_ptr(), utf16.len() as u32) };
        if bstr.is_null() {
            return Err("SysAllocStringLen failed".into());
        }
        Ok(Self {
            vt: VT_BSTR,
            reserved1: 0,
            reserved2: 0,
            reserved3: 0,
            data: VariantData { bstr },
            reserved: 0,
        })
    }
}

#[repr(C)]
struct DispParams {
    args: *mut Variant,
    named_args: *mut i32,
    arg_count: u32,
    named_arg_count: u32,
}

#[repr(C)]
struct ExcepInfo {
    _data: [usize; 8],
}

#[repr(C)]
struct IDispatchVtbl {
    query_interface:
        unsafe extern "system" fn(*mut IDispatch, *const Guid, *mut *mut c_void) -> Hresult,
    add_ref: unsafe extern "system" fn(*mut IDispatch) -> u32,
    release: unsafe extern "system" fn(*mut IDispatch) -> u32,
    get_type_info_count: unsafe extern "system" fn(*mut IDispatch, *mut u32) -> Hresult,
    get_type_info: unsafe extern "system" fn(*mut IDispatch, u32, u32, *mut *mut c_void) -> Hresult,
    get_ids_of_names: unsafe extern "system" fn(
        *mut IDispatch,
        *const Guid,
        *mut *mut u16,
        u32,
        u32,
        *mut i32,
    ) -> Hresult,
    invoke: unsafe extern "system" fn(
        *mut IDispatch,
        i32,
        *const Guid,
        u32,
        u16,
        *mut DispParams,
        *mut Variant,
        *mut ExcepInfo,
        *mut u32,
    ) -> Hresult,
}

#[repr(C)]
struct IDispatch {
    vtbl: *const IDispatchVtbl,
}

#[link(name = "ole32")]
unsafe extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, coinit: u32) -> Hresult;
    fn CoUninitialize();
    fn CoCreateInstance(
        clsid: *const Guid,
        outer: *mut c_void,
        context: u32,
        iid: *const Guid,
        object: *mut *mut c_void,
    ) -> Hresult;
}

#[link(name = "oleaut32")]
unsafe extern "system" {
    fn SysAllocStringLen(value: *const u16, length: u32) -> *mut u16;
    fn VariantClear(value: *mut Variant) -> Hresult;
}

struct ComApartment;

impl ComApartment {
    fn new() -> Result<Self, String> {
        // SAFETY: Initializes COM for the current worker thread.  The dispatch
        // call is synchronous and the guard uninitializes the same apartment.
        let hr = unsafe { CoInitializeEx(ptr::null_mut(), COINIT_APARTMENTTHREADED) };
        if hr < 0 { Err(format!("CoInitializeEx failed: 0x{hr:08x}")) } else { Ok(Self) }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: This is the matching call for `CoInitializeEx` above.
        unsafe { CoUninitialize() };
    }
}

unsafe fn clear_variant(value: &mut Variant) {
    // SAFETY: `value` is a stack-owned, initialized VARIANT.
    unsafe {
        let _ = VariantClear(value);
    }
}

unsafe fn release(object: *mut IDispatch) {
    if !object.is_null() {
        // SAFETY: object came from COM and owns a valid IDispatch vtable.
        unsafe {
            ((*(*object).vtbl).release)(object);
        }
    }
}

fn failed(hr: Hresult, operation: &str) -> String {
    format!("{operation} failed: HRESULT 0x{hr:08x} (Windows Search provider unavailable)")
}

fn dispid(object: *mut IDispatch, name: &str) -> Result<i32, String> {
    let mut wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut name_ptr = wide.as_mut_ptr();
    let mut id = 0;
    // SAFETY: `name_ptr` remains alive for the synchronous COM call.
    let hr = unsafe {
        ((*(*object).vtbl).get_ids_of_names)(object, &IID_NULL, &mut name_ptr, 1, 1033, &mut id)
    };
    if hr < 0 { Err(failed(hr, name)) } else { Ok(id) }
}

fn invoke(
    object: *mut IDispatch,
    name: &str,
    flags: u16,
    mut args: Vec<Variant>,
) -> Result<Variant, String> {
    let id = dispid(object, name)?;
    let mut params = DispParams {
        args: if args.is_empty() { ptr::null_mut() } else { args.as_mut_ptr() },
        named_args: ptr::null_mut(),
        arg_count: args.len() as u32,
        named_arg_count: 0,
    };
    let mut result = Variant::empty();
    let mut exception = ExcepInfo { _data: [0; 8] };
    let mut arg_error = 0;
    // SAFETY: all argument and result storage remains alive for the synchronous call.
    let hr = unsafe {
        ((*(*object).vtbl).invoke)(
            object,
            id,
            &IID_NULL,
            1033,
            flags,
            &mut params,
            &mut result,
            &mut exception,
            &mut arg_error,
        )
    };
    // Arguments may own BSTRs.  Clear them after Invoke copied/consumed them.
    for arg in &mut args {
        // SAFETY: every element was initialized by one of the constructors above.
        unsafe { clear_variant(arg) };
    }
    if hr < 0 {
        // SAFETY: result is initialized even for failed Invoke and may contain a partial value.
        unsafe { clear_variant(&mut result) };
        Err(failed(hr, name))
    } else {
        Ok(result)
    }
}

fn value_string(value: &mut Variant) -> Option<String> {
    if value.vt != VT_BSTR {
        return None;
    }
    // BSTRs are length-prefixed immediately before the pointer.  Use
    // `SysStringLen` semantics without relying on a second ABI declaration by
    // scanning until NUL; Windows Search paths cannot contain embedded NULs.
    // SAFETY: VT_BSTR guarantees a valid NUL-terminated wide string.
    let ptr = unsafe { value.data.bstr };
    if ptr.is_null() {
        return None;
    }
    let mut len = 0usize;
    // SAFETY: COM owns the BSTR and it is valid for the duration of `value`.
    unsafe {
        while *ptr.add(len) != 0 {
            len += 1;
        }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len)))
    }
}

fn value_bool(value: &mut Variant) -> bool {
    value.vt == VT_BOOL && unsafe { value.data.i16 } != 0
}

fn dispatch_value(value: &mut Variant) -> Result<*mut IDispatch, String> {
    if value.vt != VT_DISPATCH {
        return Err("Windows Search returned a non-dispatch object".into());
    }
    // The returned dispatch is owned by `value`; caller must not release it
    // separately until after the value is cleared.  Clone the COM reference.
    let object = unsafe { value.data.dispatch };
    if object.is_null() {
        return Err("Windows Search returned a null dispatch".into());
    }
    // SAFETY: object is a valid IDispatch pointer from the VARIANT.
    unsafe {
        ((*(*object).vtbl).add_ref)(object);
    }
    Ok(object)
}

fn search(query: &str) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("search_windows requires a non-empty query".into());
    }
    let _apartment = ComApartment::new()?;
    let mut raw: *mut c_void = ptr::null_mut();
    // SAFETY: CLSID/IID identify the registered ADO Connection COM class.
    let hr = unsafe {
        CoCreateInstance(
            &CLSID_ADODB_CONNECTION,
            ptr::null_mut(),
            CLSCTX_INPROC_SERVER,
            &IID_IDISPATCH,
            &mut raw,
        )
    };
    if hr < 0 {
        return Err(failed(hr, "ADODB.Connection"));
    }
    let connection = raw.cast::<IDispatch>();
    let connection_string =
        "Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\"";
    let open_args = vec![
        Variant::missing(),
        Variant::missing(),
        Variant::missing(),
        Variant::bstr(connection_string)?,
    ];
    let mut opened = invoke(connection, "Open", DISPATCH_METHOD, open_args)?;
    // Open returns no useful value; release any provider-owned result.
    unsafe { clear_variant(&mut opened) };
    let escaped = query.replace('\'', "''");
    let sql = format!(
        "SELECT System.ItemPathDisplay FROM SystemIndex WHERE FREETEXT('{escaped}') OR \
         System.FileName LIKE '%{escaped}%' ORDER BY System.DateModified DESC"
    );
    let mut executed = invoke(
        connection,
        "Execute",
        DISPATCH_METHOD,
        vec![Variant::missing(), Variant::bstr(&sql)?],
    )?;
    let recordset = dispatch_value(&mut executed)?;
    unsafe { clear_variant(&mut executed) };

    let mut results = Vec::new();
    while results.len() < 1_000 {
        let mut eof = invoke(recordset, "EOF", DISPATCH_PROPERTYGET, Vec::new())?;
        let at_end = value_bool(&mut eof);
        unsafe { clear_variant(&mut eof) };
        if at_end {
            break;
        }
        let mut fields = invoke(recordset, "Fields", DISPATCH_PROPERTYGET, Vec::new())?;
        let fields_object = dispatch_value(&mut fields)?;
        unsafe { clear_variant(&mut fields) };
        let mut field = invoke(fields_object, "Item", DISPATCH_PROPERTYGET, vec![Variant::i4(0)])?;
        unsafe {
            release(fields_object);
        }
        let field_object = dispatch_value(&mut field)?;
        unsafe { clear_variant(&mut field) };
        let mut path = invoke(field_object, "Value", DISPATCH_PROPERTYGET, Vec::new())?;
        unsafe {
            release(field_object);
        }
        if let Some(path) = value_string(&mut path) {
            results.push(path);
        }
        unsafe { clear_variant(&mut path) };
        let mut moved = invoke(recordset, "MoveNext", DISPATCH_METHOD, Vec::new())?;
        unsafe { clear_variant(&mut moved) };
    }
    unsafe {
        release(recordset);
        release(connection);
    }
    Ok(serde_json::json!({"query": query, "results": results, "count": results.len()}))
}

pub(crate) fn call(query: &str) -> Result<Value, String> {
    search(query)
}

#[cfg(test)]
mod tests {
    use super::call;

    #[test]
    fn rejects_empty_query_before_initializing_com() {
        let error = call("  ").expect_err("empty queries must be rejected");
        assert!(error.contains("non-empty query"));
    }
}
