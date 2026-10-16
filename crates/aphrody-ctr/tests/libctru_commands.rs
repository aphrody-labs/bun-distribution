//! Differential test against the pinned, unmodified libctru command function fixtures.
//! Requires a host C compiler (`CC`, Windows `clang`, or Unix `cc`); no Nintendo SDK is needed.
use aphrody_ctr::gpu::{encode_writes, finalize_commands};
use std::{fs, process::Command};

#[test]
fn native_libctru_command_parity() {
    let source = include_str!("fixtures/libctru-gpu-commands.c");
    let harness = format!(
        "#include <stdint.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\
         #if defined(_WIN32)\n#include <fcntl.h>\n#include <io.h>\n#define INIT_STDOUT() _setmode(_fileno(stdout), _O_BINARY)\n#else\n#define INIT_STDOUT() ((void)0)\n#endif\ntypedef uint32_t u32;\n#define BIT(n) (1u << (n))\n\
         #define USERBREAK_PANIC 0\n#define svcBreak(n) abort()\n\
         #define GPUREG_FINALIZE 0x10\n\
         #define GPUCMD_AddWrite(reg,val) do {{ u32 p=(val); GPUCMD_Add((15u<<16)|(reg),&p,1); }} while(0)\n{}\n\
         int main(void) {{\nINIT_STDOUT();\n\
         const u32 lengths[] = {{1,2,3,255,256,257,511,512,513,1025}};\n\
         u32 params[1025], buffer[1100];\n\
         for(u32 i=0;i<1025;i++) params[i]=0xabcdef00u ^ i;\n\
         for(u32 inc=0;inc<2;inc++) for(u32 mask=0;mask<16;mask++)\n\
         for(u32 k=0;k<10;k++) {{\n\
         memset(buffer,0x55,sizeof(buffer));\n\
         gpuCmdBuf=buffer; gpuCmdBufSize=1100; gpuCmdBufOffset=0;\n\
         GPUCMD_Add((inc<<31)|(mask<<16)|0x2c0,params,lengths[k]);\n\
         if(fwrite(buffer,4,gpuCmdBufOffset,stdout)!=gpuCmdBufOffset) return 1;\n\
         }}\n\
         for(u32 used=0;used<16;used+=2) {{\n\
         memset(buffer,0x55,sizeof(buffer));\n\
         gpuCmdBuf=buffer; gpuCmdBufSize=1100; gpuCmdBufOffset=used;\n\
         u32 *addr,size; GPUCMD_Split(&addr,&size);\n\
         if(fwrite(addr,4,size,stdout)!=size) return 2;\n\
         }} return 0; }}\n",
        source
    );
    let temporary =
        std::env::temp_dir().join(format!("aphrody-ctr-c-parity-{}", std::process::id()));
    fs::create_dir_all(&temporary).unwrap();
    let c_file = temporary.join("reference.c");
    let executable = temporary.join(if cfg!(windows) { "reference.exe" } else { "reference" });
    fs::write(&c_file, harness).unwrap();
    let compiler = std::env::var_os("CC")
        .unwrap_or_else(|| if cfg!(windows) { "clang".into() } else { "cc".into() });
    let compile = Command::new(compiler)
        .args(["-std=c11", "-Wall", "-Wextra", "-Werror"])
        .arg(&c_file)
        .arg("-o")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(compile.status.success(), "{}", String::from_utf8_lossy(&compile.stderr));
    let reference = Command::new(&executable).output().unwrap();
    assert!(reference.status.success());
    let params: [u32; 1025] = core::array::from_fn(|i| 0xabcdef00 ^ i as u32);
    let mut expected = Vec::new();
    for incremental in [false, true] {
        for mask in 0..16 {
            for length in [1, 2, 3, 255, 256, 257, 511, 512, 513, 1025] {
                let mut buffer = [0x55555555; 1100];
                let size = encode_writes(&mut buffer, 0x2c0, mask, incremental, &params[..length])
                    .unwrap();
                for word in &buffer[..size] {
                    expected.extend(word.to_ne_bytes());
                }
            }
        }
    }
    for used in (0..16).step_by(2) {
        let mut buffer = [0x55555555; 20];
        let size = finalize_commands(&mut buffer, used).unwrap();
        for word in &buffer[..size] {
            expected.extend(word.to_ne_bytes());
        }
    }
    assert_eq!(reference.stdout, expected);
    fs::remove_file(c_file).unwrap();
    fs::remove_file(executable).unwrap();
    fs::remove_dir(temporary).unwrap();
}
