// SPDX-License-Identifier: Apache-2.0
//! Application patterns based on the available window width, independent of the host OS.

pub use m3_tokens::adaptive::Breakpoint as WindowClass;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Navigation {
    None,
    Bar,
    RailCollapsed,
    RailExpanded,
    Drawer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Panes {
    Single,
    ListDetail,
    Supporting,
    Workspace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplicationFamily {
    Editor,
    Terminal,
    Browser,
    Files,
    Reader,
    Media,
    Settings,
    Dashboard,
    Launcher,
    Panel,
    Dialog,
    Mobile,
    Game,
    Tool,
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApplicationLayout {
    pub family: ApplicationFamily,
    pub navigation: Navigation,
    pub panes: Panes,
    pub toolbar: bool,
    pub scroll_content: bool,
    pub edge_to_edge: bool,
}

impl ApplicationFamily {
    pub const ALL: [Self; 15] = [
        Self::Editor,
        Self::Terminal,
        Self::Browser,
        Self::Files,
        Self::Reader,
        Self::Media,
        Self::Settings,
        Self::Dashboard,
        Self::Launcher,
        Self::Panel,
        Self::Dialog,
        Self::Mobile,
        Self::Game,
        Self::Tool,
        Self::Desktop,
    ];

    pub const fn layout(self, width_dp: u32) -> ApplicationLayout {
        use ApplicationFamily::*;
        let class = WindowClass::from_width_dp(width_dp);
        let navigation = match self {
            Terminal | Panel | Dialog | Game | Tool | Desktop => Navigation::None,
            _ => match class.navigation() {
                m3_tokens::adaptive::Navigation::Bar => Navigation::Bar,
                m3_tokens::adaptive::Navigation::RailCollapsed => Navigation::RailCollapsed,
                m3_tokens::adaptive::Navigation::RailExpanded => Navigation::RailExpanded,
            },
        };
        let panes = if class.recommended_panes() == 1 {
            Panes::Single
        } else {
            match self {
                Files | Settings | Reader => Panes::ListDetail,
                Editor | Browser | Dashboard | Desktop => Panes::Workspace,
                Media | Tool => Panes::Supporting,
                _ => Panes::Single,
            }
        };
        ApplicationLayout {
            family: self,
            navigation,
            panes,
            toolbar: matches!(self, Editor | Browser | Files | Media | Reader | Tool),
            scroll_content: matches!(
                self,
                Files | Reader | Settings | Dashboard | Launcher | Mobile
            ),
            edge_to_edge: matches!(self, Terminal | Media | Panel | Game | Desktop),
        }
    }
}
