use koharu_library::project::Project;
use tokio::sync::Mutex;

pub(crate) struct CurrentProject {
    pub(crate) project: Mutex<Option<Project>>,
}
