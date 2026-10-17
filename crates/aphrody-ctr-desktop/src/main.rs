//! `aphrody-ctr`: desktop Nintendo 3DS emulator.
//!
//! ```text
//! aphrody-ctr <title.3dsx|.cxi|.cci|.3ds|.cia> [--new3ds] [--region jpn|usa|eur] [--data DIR]
//!             [--slider 0..1] [--headless FRAMES]
//! ```
//!
//! Keys: X/Z/S/A = A/B/X/Y, Q/W = L/R, Enter = Start, Backspace = Select, arrows = D-pad,
//! I/J/K/L = circle pad, mouse = touch. F5/F9 save/load the state next to the title, F3 toggles
//! the anaglyph 3D view, F11 fullscreen, P pauses, Tab fast-forwards, Esc quits.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use aphrody_ctr_desktop::audio::Audio;
use aphrody_ctr_desktop::emu::{Buttons, Emu, Frame, Input, Model, REFRESH_RATE, Region};
use aphrody_ctr_desktop::{Layout, Renderer, Stereo};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Fullscreen, Window, WindowId};

struct Options {
    title: PathBuf,
    model: Model,
    region: Region,
    data: Option<PathBuf>,
    slider: f32,
    headless: Option<u64>,
}

fn parse() -> Result<Options, String> {
    let mut args = std::env::args().skip(1);
    let mut title = None;
    let mut options = Options {
        title: PathBuf::new(),
        model: Model::Old3ds,
        region: Region::Usa,
        data: None,
        slider: 0.0,
        headless: None,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--new3ds" => options.model = Model::New3ds,
            "--region" => {
                options.region = match args.next().as_deref() {
                    Some("jpn") => Region::Japan,
                    Some("usa") => Region::Usa,
                    Some("eur") => Region::Europe,
                    other => {
                        return Err(format!("--region expects jpn, usa or eur, got {other:?}"));
                    }
                }
            }
            "--data" => {
                options.data = Some(args.next().ok_or("--data expects a directory")?.into())
            }
            "--slider" => {
                options.slider = args
                    .next()
                    .and_then(|v| v.parse().ok())
                    .ok_or("--slider expects a number from 0 to 1")?
            }
            "--headless" => {
                options.headless = Some(
                    args.next()
                        .and_then(|v| v.parse().ok())
                        .ok_or("--headless expects a frame count")?,
                )
            }
            "-h" | "--help" => return Err(String::new()),
            _ if arg.starts_with("--") => return Err(format!("unknown option {arg}")),
            _ => title = Some(PathBuf::from(arg)),
        }
    }
    options.title = title.ok_or("missing title path")?;
    Ok(options)
}

fn boot(options: &Options) -> Result<Emu, String> {
    let mut builder = Emu::builder()
        .model(options.model)
        .region(options.region)
        .slider_3d(options.slider);
    if let Some(dir) = &options.data {
        builder = builder.data_dir(dir);
    }
    builder.boot(&options.title).map_err(|e| e.to_string())
}

struct Gfx {
    window: Arc<Window>,
    renderer: Renderer,
}

struct App {
    emu: Emu,
    options: Options,
    gfx: Option<Gfx>,
    audio: Option<Audio>,
    buttons: Buttons,
    circle: [f32; 2],
    touch_down: bool,
    cursor: (f32, f32),
    paused: bool,
    fast: bool,
    next_frame: Instant,
}

impl App {
    fn input(&self) -> Input {
        let touch = if self.touch_down {
            self.gfx.as_ref().and_then(|g| {
                let size = g.window.inner_size();
                Layout::new(size.width, size.height).touch(self.cursor.0, self.cursor.1)
            })
        } else {
            None
        };
        Input {
            buttons: self.buttons,
            circle: self.circle,
            touch,
            ..Input::default()
        }
    }

    fn state_path(&self) -> PathBuf {
        self.options.title.with_extension("state")
    }

    fn key(&mut self, event_loop: &ActiveEventLoop, code: KeyCode, pressed: bool) {
        let button = match code {
            KeyCode::KeyX => Some(Buttons::A),
            KeyCode::KeyZ => Some(Buttons::B),
            KeyCode::KeyS => Some(Buttons::X),
            KeyCode::KeyA => Some(Buttons::Y),
            KeyCode::KeyQ => Some(Buttons::L),
            KeyCode::KeyW => Some(Buttons::R),
            KeyCode::Enter => Some(Buttons::START),
            KeyCode::Backspace => Some(Buttons::SELECT),
            KeyCode::ArrowUp => Some(Buttons::UP),
            KeyCode::ArrowDown => Some(Buttons::DOWN),
            KeyCode::ArrowLeft => Some(Buttons::LEFT),
            KeyCode::ArrowRight => Some(Buttons::RIGHT),
            _ => None,
        };
        if let Some(button) = button {
            self.buttons.set(button, pressed);
        }
        let axis = if pressed { 1.0 } else { 0.0 };
        match code {
            KeyCode::KeyJ => self.circle[0] = -axis,
            KeyCode::KeyL => self.circle[0] = axis,
            KeyCode::KeyI => self.circle[1] = axis,
            KeyCode::KeyK => self.circle[1] = -axis,
            KeyCode::Tab => self.fast = pressed,
            _ if !pressed => {}
            KeyCode::Escape => event_loop.exit(),
            KeyCode::KeyP => self.paused = !self.paused,
            KeyCode::F3 => {
                if let Some(gfx) = &mut self.gfx {
                    let next = match gfx.renderer.stereo() {
                        Stereo::Off => Stereo::Anaglyph,
                        Stereo::Anaglyph => Stereo::Off,
                    };
                    gfx.renderer.set_stereo(next);
                    self.emu
                        .set_slider_3d(if next == Stereo::Anaglyph { 1.0 } else { 0.0 });
                }
            }
            KeyCode::F5 => match self.emu.save_state() {
                Ok(state) => match std::fs::write(self.state_path(), state) {
                    Ok(()) => eprintln!("state saved"),
                    Err(e) => eprintln!("state: {e}"),
                },
                Err(e) => eprintln!("state: {e}"),
            },
            KeyCode::F9 => match std::fs::read(self.state_path()) {
                Ok(state) => match self.emu.load_state(&state) {
                    Ok(()) => eprintln!("state loaded"),
                    Err(e) => eprintln!("state: {e}"),
                },
                Err(e) => eprintln!("state: {e}"),
            },
            KeyCode::F11 => {
                if let Some(gfx) = &self.gfx {
                    let on = gfx.window.fullscreen().is_none();
                    gfx.window
                        .set_fullscreen(on.then_some(Fullscreen::Borderless(None)));
                }
            }
            _ => {}
        }
    }

    /// Runs the frames that are due. Returns false when the title stopped.
    fn step(&mut self, event_loop: &ActiveEventLoop) {
        if self.paused {
            self.next_frame = Instant::now();
            return;
        }
        let period = Duration::from_secs_f64(1.0 / REFRESH_RATE);
        let now = Instant::now();
        let mut ran = 0;
        while (self.fast || self.next_frame <= now) && ran < 4 {
            self.emu.set_input(self.input());
            match self.emu.run_frame() {
                Frame::Completed => {}
                Frame::Exited => {
                    eprintln!("the title exited");
                    event_loop.exit();
                    return;
                }
                Frame::Faulted(why) => {
                    eprintln!("guest fault {why}");
                    event_loop.exit();
                    return;
                }
            }
            let console = self.emu.take_console();
            if !console.is_empty() {
                print!("{console}");
            }
            let pcm = self.emu.take_audio();
            if let Some(audio) = &self.audio
                && !self.fast
            {
                audio.push(&pcm);
            }
            self.next_frame += period;
            ran += 1;
            if self.fast {
                break;
            }
        }
        if self.next_frame + period * 4 < now {
            self.next_frame = now;
        }
        if ran > 0
            && let Some(gfx) = &mut self.gfx
        {
            let video = self.emu.video();
            gfx.renderer.render(&video);
        }
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.gfx.is_some() {
            return;
        }
        let attributes = Window::default_attributes()
            .with_title("Bun OS 3DS")
            .with_inner_size(LogicalSize::new(800.0, 960.0))
            .with_min_inner_size(LogicalSize::new(400.0, 480.0));
        let window = match event_loop.create_window(attributes) {
            Ok(window) => Arc::new(window),
            Err(e) => {
                eprintln!("window: {e}");
                event_loop.exit();
                return;
            }
        };
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
        let size = window.inner_size();
        let renderer = instance
            .create_surface(window.clone())
            .map_err(|e| e.to_string())
            .and_then(|surface| {
                pollster::block_on(Renderer::new(&instance, surface, (size.width, size.height)))
            });
        match renderer {
            Ok(renderer) => self.gfx = Some(Gfx { window, renderer }),
            Err(e) => {
                eprintln!("renderer: {e}");
                event_loop.exit();
            }
        }
        self.next_frame = Instant::now();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(gfx) = &mut self.gfx {
                    gfx.renderer.resize(size.width, size.height);
                }
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if let PhysicalKey::Code(code) = event.physical_key
                    && !event.repeat
                {
                    self.key(event_loop, code, event.state == ElementState::Pressed);
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                self.cursor = (position.x as f32, position.y as f32);
            }
            WindowEvent::MouseInput {
                state,
                button: MouseButton::Left,
                ..
            } => {
                self.touch_down = state == ElementState::Pressed;
            }
            WindowEvent::Focused(false) => {
                self.buttons = Buttons::empty();
                self.circle = [0.0; 2];
                self.touch_down = false;
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.step(event_loop);
        let wake = if self.fast || self.paused {
            Instant::now() + Duration::from_millis(8)
        } else {
            self.next_frame
        };
        event_loop.set_control_flow(ControlFlow::WaitUntil(wake));
    }
}

fn headless(mut emu: Emu, frames: u64) {
    for _ in 0..frames {
        match emu.run_frame() {
            Frame::Completed => {}
            Frame::Exited => break,
            Frame::Faulted(why) => {
                eprintln!("guest fault {why}");
                break;
            }
        }
        print!("{}", emu.take_console());
    }
    eprintln!("{}", emu.debug().status_line());
}

fn main() {
    let options = match parse() {
        Ok(options) => options,
        Err(message) => {
            if !message.is_empty() {
                eprintln!("{message}");
            }
            eprintln!(
                "usage: aphrody-ctr <title> [--new3ds] [--region jpn|usa|eur] [--data DIR] [--slider 0..1] [--headless FRAMES]"
            );
            std::process::exit(2);
        }
    };
    let emu = match boot(&options) {
        Ok(emu) => emu,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    };
    if let Some(frames) = options.headless {
        headless(emu, frames);
        return;
    }
    let event_loop = match EventLoop::new() {
        Ok(l) => l,
        Err(e) => {
            eprintln!("event loop: {e}");
            std::process::exit(1);
        }
    };
    let mut app = App {
        emu,
        options,
        gfx: None,
        audio: Audio::open(),
        buttons: Buttons::empty(),
        circle: [0.0; 2],
        touch_down: false,
        cursor: (0.0, 0.0),
        paused: false,
        fast: false,
        next_frame: Instant::now(),
    };
    if let Err(e) = event_loop.run_app(&mut app) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
