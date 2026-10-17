//! Output-map parity against the pinned libctru function fixture, not a rewritten oracle.
use aphrody_ctr::shader::OutputMap;
use std::{fs, process::Command};

#[test]
fn native_libctru_output_map_parity() {
    let function = include_str!("fixtures/libctru-shader-outmap.c");
    let harness = format!(
        r#"
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#define INIT_STDOUT() _setmode(_fileno(stdout), _O_BINARY)
#else
#define INIT_STDOUT() ((void)0)
#endif
typedef uint32_t u32;
#define BIT(n) (1u << (n))
enum {{ RESULT_POSITION, RESULT_NORMALQUAT, RESULT_COLOR, RESULT_TEXCOORD0,
RESULT_TEXCOORD0W, RESULT_TEXCOORD1, RESULT_TEXCOORD2, RESULT_VIEW=8 }};
typedef struct {{ uint16_t type, regID; uint8_t mask, unk[3]; }} Entry;
typedef struct {{ u32 outTableSize; Entry *outTableData; uint8_t outmapMask;
u32 outmapData[8], outmapMode, outmapClock; }} DVLE_s;
{}
int main(void) {{
INIT_STDOUT();
for(unsigned type=0;type<12;type++) {{
for(unsigned reg=0;reg<7;reg++) {{
for(unsigned mask=0;mask<16;mask++) {{
Entry entries[2]={{{{type,reg,mask,{{0}}}},{{3,reg,3,{{0}}}}}};
DVLE_s shader={{0}}; shader.outTableSize=2; shader.outTableData=entries;
DVLE_GenerateOutmap(&shader);
u32 result[11]; result[0]=shader.outmapMask;
memcpy(result+1,shader.outmapData,32); result[9]=shader.outmapMode; result[10]=shader.outmapClock;
if(fwrite(result,4,11,stdout)!=11) return 1;
}}
}}
}}
return 0;
}}
"#,
        function
    );
    let directory =
        std::env::temp_dir().join(format!("iecode-shader-parity-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let input = directory.join("reference.c");
    let output = directory.join(if cfg!(windows) {
        "reference.exe"
    } else {
        "reference"
    });
    fs::write(&input, harness).unwrap();
    let compile = Command::new(std::env::var_os("CC").unwrap_or_else(|| {
        if cfg!(windows) {
            "clang".into()
        } else {
            "cc".into()
        }
    }))
    // The unchanged SDK uses an int loop index with a u32 table count.
    .args([
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-Wno-sign-compare",
    ])
    .arg(&input)
    .arg("-o")
    .arg(&output)
    .output()
    .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let reference = Command::new(&output).output().unwrap();
    assert!(reference.status.success());
    let mut expected = Vec::new();
    for kind in 0..12 {
        for register in 0..7 {
            for mask in 0..16 {
                let mut map = OutputMap::default();
                map.add(kind, register, mask).unwrap();
                map.add(3, register, 3).unwrap();
                for value in core::iter::once(map.mask as u32)
                    .chain(map.data)
                    .chain([map.mode, map.clock])
                {
                    expected.extend(value.to_ne_bytes());
                }
            }
        }
    }
    assert_eq!(
        reference.stdout, expected,
        "1344 SDK shader output-map cases"
    );
    fs::remove_file(input).unwrap();
    fs::remove_file(output).unwrap();
    fs::remove_dir(directory).unwrap();
}
