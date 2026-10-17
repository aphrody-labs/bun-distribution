fn main() -> std::process::ExitCode {
    bun_os_shell::main(std::env::args().skip(1))
}
