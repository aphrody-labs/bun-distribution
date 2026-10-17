//! Shared UI pieces: the widget kit (Material 3 text, buttons, chips, cards, icons as Bevy UI
//! bundles), springs from the M3 motion tokens (reduced motion snaps them), controller-first input
//! (gamepads through `bevy_gilrs`, keyboard, mouse via picking) turned into navigation intents, and
//! focus handling on top of Bevy's automatic directional navigation.

use std::time::Duration;

use aphrody_m3_tokens::motion::{self, M3Spring, SpringState};
use bevy::input::gamepad::{GamepadRumbleIntensity, GamepadRumbleRequest};
use bevy::input_focus::{FocusCause, InputFocus, InputFocusVisible};
use bevy::math::CompassOctant;
use bevy::picking::events::{PointerClick, PointerOver, PointerScroll};
use bevy::prelude::*;
use bevy::text::{FontSize, FontWeight};
use bevy::ui::auto_directional_navigation::{AutoDirectionalNavigation, AutoDirectionalNavigator};

use crate::assets::{Fonts, Icons, Sounds};
use crate::theme::{Theme, typescale::Style};

/// Everything a view needs to build widgets.
#[derive(Resource, Clone)]
pub struct Kit {
    pub theme: Theme,
    pub font: Handle<Font>,
    pub icons: std::collections::HashMap<&'static str, Handle<Image>>,
}

impl Kit {
    pub fn from_world(theme: &Theme, fonts: &Fonts, icons: &Icons) -> Self {
        Self {
            theme: theme.clone(),
            font: fonts.text.clone(),
            icons: icons.0.clone(),
        }
    }

    pub fn text(
        &self,
        value: impl Into<String>,
        style: Style,
        color: Color,
    ) -> (Text, TextFont, TextColor) {
        (
            Text::new(value),
            TextFont {
                font: self.font.clone().into(),
                font_size: FontSize::Px(style.size),
                weight: FontWeight(style.weight),
                ..default()
            },
            TextColor(color),
        )
    }

    pub fn icon(&self, name: &str, size: f32, color: Color) -> (ImageNode, Node) {
        (
            ImageNode::new(self.icons.get(name).cloned().unwrap_or_default()).with_color(color),
            Node {
                width: px(size),
                height: px(size),
                flex_shrink: 0.0,
                ..default()
            },
        )
    }
}

/// Which input layer an item belongs to: screen items lose navigation while an overlay is open.
#[derive(Component, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    Screen,
    Overlay,
}

/// A focusable control and what Accept does on it.
#[derive(Component, Clone, Debug, PartialEq)]
pub struct Focusable(pub crate::app::Action);

/// Focus animation: scale and outline follow a spring toward 1 when focused.
#[derive(Component, Clone, Copy)]
pub struct FocusFx {
    pub grow: f32,
    pub state: SpringState,
}

impl FocusFx {
    pub fn new(grow: f32) -> Self {
        Self {
            grow,
            state: SpringState::default(),
        }
    }
}

/// Initial focus of a freshly built view.
#[derive(Component)]
pub struct DefaultFocus;

#[derive(Resource, Clone, Copy)]
pub struct Motion {
    pub reduced: bool,
}

/// One-dimensional spring toward `target` (M3 expressive spatial spring by default).
#[derive(Clone, Copy)]
pub struct Spring {
    pub spring: M3Spring,
    pub state: SpringState,
    pub target: f32,
}

impl Spring {
    pub fn new(value: f32, spring: M3Spring) -> Self {
        Self {
            spring,
            state: SpringState {
                value,
                velocity: 0.0,
            },
            target: value,
        }
    }

    pub fn spatial(value: f32) -> Self {
        Self::new(value, motion::EXPRESSIVE_DEFAULT_SPATIAL)
    }

    pub fn effects(value: f32) -> Self {
        Self::new(value, motion::DEFAULT_EFFECTS)
    }

    /// Advance by `dt` seconds (fixed 4 ms substeps); returns true while moving.
    pub fn step(&mut self, dt: f32, reduced: bool) -> bool {
        if reduced {
            self.state = SpringState {
                value: self.target,
                velocity: 0.0,
            };
            return false;
        }
        let mut left = dt.min(0.1);
        while left > 0.0 {
            let h = left.min(0.004);
            self.spring.step(&mut self.state, self.target, h);
            left -= h;
        }
        let settled =
            (self.state.value - self.target).abs() < 0.0005 && self.state.velocity.abs() < 0.005;
        if settled {
            self.state = SpringState {
                value: self.target,
                velocity: 0.0,
            };
        }
        !settled
    }

    pub fn value(&self) -> f32 {
        self.state.value
    }
}

/// Navigation intents from every input device and from `--script`.
#[derive(Message, Clone, Copy, Debug, PartialEq)]
pub enum Intent {
    Move(CompassOctant),
    Accept,
    Back,
    Guide,
    PrevTab,
    NextTab,
}

/// Accept on a control (or a click) asks the app to run its action.
#[derive(Message, Clone, Debug)]
pub struct Activate(pub crate::app::Action);

/// Feedback the shell plays for an intent: sound effect and controller haptics.
#[derive(Message, Clone, Copy)]
pub enum Feedback {
    Navigate,
    Select,
    Back,
    Open,
}

#[derive(Resource, Default)]
pub struct Repeat {
    held: Option<(CompassOctant, f32)>,
}

const REPEAT_DELAY: f32 = 0.38;
const REPEAT_RATE: f32 = 0.085;

fn direction(x: f32, y: f32) -> Option<CompassOctant> {
    if x.abs() < 0.5 && y.abs() < 0.5 {
        return None;
    }
    Some(if x.abs() > y.abs() {
        if x > 0.0 {
            CompassOctant::East
        } else {
            CompassOctant::West
        }
    } else if y > 0.0 {
        CompassOctant::North
    } else {
        CompassOctant::South
    })
}

/// Keyboard and gamepads to intents (in-game input is routed to the machine instead).
#[allow(clippy::too_many_arguments)]
pub fn gather(
    keys: Res<ButtonInput<KeyCode>>,
    pads: Query<&Gamepad>,
    time: Res<Time>,
    mut repeat: ResMut<Repeat>,
    mut intents: MessageWriter<Intent>,
    playing: Res<State<crate::app::Screen>>,
    overlay: Res<State<crate::app::Overlay>>,
) {
    let in_game = *playing.get() == crate::app::Screen::Playing
        && *overlay.get() == crate::app::Overlay::Closed;
    // Guide: keyboard Home/F1 (Escape too while a game is shown), the pad Guide button when the
    // backend reports it, or View+Menu held together.
    let mut guide = keys.just_pressed(KeyCode::Home)
        || keys.just_pressed(KeyCode::F1)
        || (in_game && keys.just_pressed(KeyCode::Escape));
    for pad in &pads {
        guide |= pad.just_pressed(GamepadButton::Mode);
        let chord = pad.pressed(GamepadButton::Select) && pad.pressed(GamepadButton::Start);
        guide |= chord
            && (pad.just_pressed(GamepadButton::Select) || pad.just_pressed(GamepadButton::Start));
        if !in_game && pad.just_pressed(GamepadButton::Select) && !pad.pressed(GamepadButton::Start)
        {
            guide = true;
        }
    }
    if guide {
        intents.write(Intent::Guide);
    }
    if in_game {
        repeat.held = None;
        return;
    }
    let mut x = 0.0;
    let mut y = 0.0;
    let held = |k: KeyCode| keys.pressed(k);
    if held(KeyCode::ArrowLeft) || held(KeyCode::KeyA) {
        x -= 1.0;
    }
    if held(KeyCode::ArrowRight) || held(KeyCode::KeyD) {
        x += 1.0;
    }
    if held(KeyCode::ArrowUp) || held(KeyCode::KeyW) {
        y += 1.0;
    }
    if held(KeyCode::ArrowDown) || held(KeyCode::KeyS) {
        y -= 1.0;
    }
    let mut accept = keys.just_pressed(KeyCode::Enter) || keys.just_pressed(KeyCode::Space);
    let mut back = keys.just_pressed(KeyCode::Escape) || keys.just_pressed(KeyCode::Backspace);
    let mut prev = keys.just_pressed(KeyCode::KeyQ) || keys.just_pressed(KeyCode::PageUp);
    let mut next = keys.just_pressed(KeyCode::KeyE) || keys.just_pressed(KeyCode::PageDown);
    for pad in &pads {
        let stick = pad.left_stick();
        x += stick.x;
        y += stick.y;
        x += f32::from(pad.pressed(GamepadButton::DPadRight))
            - f32::from(pad.pressed(GamepadButton::DPadLeft));
        y += f32::from(pad.pressed(GamepadButton::DPadUp))
            - f32::from(pad.pressed(GamepadButton::DPadDown));
        accept |= pad.just_pressed(GamepadButton::South);
        back |= pad.just_pressed(GamepadButton::East);
        prev |= pad.just_pressed(GamepadButton::LeftTrigger);
        next |= pad.just_pressed(GamepadButton::RightTrigger);
    }
    match (direction(x, y), repeat.held) {
        (Some(dir), Some((held, t))) if dir == held => {
            let t = t - time.delta_secs();
            if t <= 0.0 {
                intents.write(Intent::Move(dir));
                repeat.held = Some((dir, REPEAT_RATE));
            } else {
                repeat.held = Some((dir, t));
            }
        }
        (Some(dir), _) => {
            intents.write(Intent::Move(dir));
            repeat.held = Some((dir, REPEAT_DELAY));
        }
        (None, _) => repeat.held = None,
    }
    if accept {
        intents.write(Intent::Accept);
    }
    if back {
        intents.write(Intent::Back);
    }
    if prev {
        intents.write(Intent::PrevTab);
    }
    if next {
        intents.write(Intent::NextTab);
    }
}

/// Moves focus for direction intents, activates the focused control on Accept.
pub fn navigate(
    mut intents: MessageReader<Intent>,
    mut navigator: AutoDirectionalNavigator,
    focusables: Query<&Focusable>,
    mut activate: MessageWriter<Activate>,
    mut feedback: MessageWriter<Feedback>,
    mut visible: ResMut<InputFocusVisible>,
) {
    for intent in intents.read() {
        match *intent {
            Intent::Move(dir) => {
                visible.0 = true;
                if navigator.navigate(dir).is_ok() {
                    feedback.write(Feedback::Navigate);
                }
            }
            Intent::Accept => {
                if let Some(action) = navigator.input_focus().and_then(|e| focusables.get(e).ok()) {
                    feedback.write(Feedback::Select);
                    activate.write(Activate(action.0.clone()));
                }
            }
            _ => {}
        }
    }
}

/// Mouse hover moves focus; click activates.
pub fn on_pointer_over(
    mut over: On<PointerOver>,
    focusables: Query<(), With<Focusable>>,
    nav: Query<(), With<AutoDirectionalNavigation>>,
    mut focus: ResMut<InputFocus>,
) {
    if focusables.contains(over.entity) && nav.contains(over.entity) {
        over.propagate(false);
        if focus.get() != Some(over.entity) {
            focus.set(over.entity, FocusCause::Pressed);
        }
    }
}

pub fn on_pointer_click(
    mut click: On<PointerClick>,
    focusables: Query<&Focusable, With<AutoDirectionalNavigation>>,
    mut activate: MessageWriter<Activate>,
    mut feedback: MessageWriter<Feedback>,
) {
    if let Ok(action) = focusables.get(click.entity) {
        click.propagate(false);
        feedback.write(Feedback::Select);
        activate.write(Activate(action.0.clone()));
    }
}

/// The mouse wheel moves focus like a stick.
pub fn on_pointer_scroll(mut scroll: On<PointerScroll>, mut intents: MessageWriter<Intent>) {
    scroll.propagate(false);
    if scroll.y.abs() > scroll.x.abs() && scroll.y != 0.0 {
        intents.write(Intent::Move(if scroll.y > 0.0 {
            CompassOctant::West
        } else {
            CompassOctant::East
        }));
    } else if scroll.x != 0.0 {
        intents.write(Intent::Move(if scroll.x > 0.0 {
            CompassOctant::East
        } else {
            CompassOctant::West
        }));
    }
}

/// Only the active layer participates in directional navigation.
pub fn sync_layers(
    mut commands: Commands,
    overlay: Res<State<crate::app::Overlay>>,
    items: Query<(Entity, &Layer, Has<AutoDirectionalNavigation>), With<Focusable>>,
) {
    let open = *overlay.get() != crate::app::Overlay::Closed;
    for (entity, layer, has) in &items {
        let active = (*layer == Layer::Overlay) == open;
        if active && !has {
            commands
                .entity(entity)
                .insert(AutoDirectionalNavigation::default());
        } else if !active && has {
            commands
                .entity(entity)
                .remove::<AutoDirectionalNavigation>();
        }
    }
}

/// Focus the `DefaultFocus` item of the active layer when nothing valid is focused.
pub fn ensure_focus(
    mut commands: Commands,
    mut focus: ResMut<InputFocus>,
    valid: Query<&Layer, With<AutoDirectionalNavigation>>,
    defaults: Query<Entity, (With<DefaultFocus>, With<AutoDirectionalNavigation>)>,
    mut remembered: Local<Option<Entity>>,
) {
    if let Some(entity) = focus.get()
        && let Ok(layer) = valid.get(entity)
    {
        if *layer == Layer::Screen {
            *remembered = Some(entity);
        }
        return;
    }
    if let Some(entity) = *remembered
        && valid.get(entity).is_ok_and(|l| *l == Layer::Screen)
    {
        focus.set(entity, FocusCause::Navigated);
        return;
    }
    if let Some(entity) = defaults.iter().next() {
        focus.set(entity, FocusCause::Navigated);
        commands.entity(entity).remove::<DefaultFocus>();
    }
}

/// Focus scale and outline on the M3 fast spatial spring.
pub fn focus_fx(
    time: Res<Time>,
    motion: Res<Motion>,
    focus: Res<InputFocus>,
    visible: Res<InputFocusVisible>,
    kit: Res<Kit>,
    mut items: Query<(Entity, &mut FocusFx, &mut UiTransform, Option<&mut Outline>)>,
) {
    let dt = time.delta_secs();
    for (entity, mut fx, mut transform, outline) in &mut items {
        let target = if focus.get() == Some(entity) && visible.0 {
            1.0
        } else {
            0.0
        };
        let mut spring = Spring {
            spring: motion::EXPRESSIVE_FAST_SPATIAL,
            state: fx.state,
            target,
        };
        spring.step(dt, motion.reduced);
        fx.state = spring.state;
        let v = spring.value();
        let scale = 1.0 + fx.grow * v;
        if (transform.scale.x - scale).abs() > 1e-4 {
            transform.scale = Vec2::splat(scale);
        }
        if let Some(mut outline) = outline {
            let alpha = v.clamp(0.0, 1.0);
            outline.color = kit.theme.primary.with_alpha(alpha);
        }
    }
}

/// Plays the UI sound and controller rumble for each feedback event.
pub fn feedback(
    mut commands: Commands,
    mut events: MessageReader<Feedback>,
    sounds: Res<Sounds>,
    settings: Res<crate::app::Settings>,
    pads: Query<Entity, With<Gamepad>>,
    mut rumble: MessageWriter<GamepadRumbleRequest>,
) {
    for event in events.read() {
        if settings.sounds {
            let (sound, volume) = match event {
                Feedback::Navigate => (&sounds.navigate, 0.35),
                Feedback::Select => (&sounds.select, 0.5),
                Feedback::Back => (&sounds.back, 0.45),
                Feedback::Open => (&sounds.open, 0.5),
            };
            commands.spawn((
                AudioPlayer::new(sound.clone()),
                PlaybackSettings {
                    volume: bevy::audio::Volume::Linear(volume),
                    ..PlaybackSettings::DESPAWN
                },
            ));
        }
        if settings.haptics {
            let (ms, intensity) = match event {
                Feedback::Navigate => (28, GamepadRumbleIntensity::weak_motor(0.25)),
                Feedback::Select => (
                    60,
                    GamepadRumbleIntensity {
                        strong_motor: 0.35,
                        weak_motor: 0.5,
                    },
                ),
                Feedback::Back => (40, GamepadRumbleIntensity::weak_motor(0.35)),
                Feedback::Open => (90, GamepadRumbleIntensity::strong_motor(0.45)),
            };
            for gamepad in &pads {
                rumble.write(GamepadRumbleRequest::Add {
                    duration: Duration::from_millis(ms),
                    intensity,
                    gamepad,
                });
            }
        }
    }
}

/// Crops an image to fill its node (CSS `object-fit: cover`).
#[derive(Component)]
pub struct Cover;

pub fn cover(
    images: Res<Assets<Image>>,
    mut nodes: Query<(&mut ImageNode, &ComputedNode), With<Cover>>,
) {
    for (mut node, computed) in &mut nodes {
        let Some(image) = images.get(&node.image) else {
            continue;
        };
        let size = image.size_f32();
        let target = computed.size();
        if size.x <= 0.0 || target.x <= 0.0 || target.y <= 0.0 {
            continue;
        }
        let (ia, ta) = (size.x / size.y, target.x / target.y);
        let rect = if ia > ta {
            let w = size.y * ta;
            Rect::new((size.x - w) / 2.0, 0.0, (size.x + w) / 2.0, size.y)
        } else {
            let h = size.x / ta;
            Rect::new(0.0, (size.y - h) * 0.2, size.x, (size.y - h) * 0.2 + h)
        };
        if node.rect != Some(rect) {
            node.rect = Some(rect);
        }
    }
}

pub fn radius(r: f32) -> BorderRadius {
    BorderRadius::all(px(r))
}
