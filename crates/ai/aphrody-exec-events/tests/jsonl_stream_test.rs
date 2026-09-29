// SPDX-License-Identifier: Apache-2.0
use aphrody_app_protocol::{
    ServerNotification,
    types::{
        item::{CommandExecutionStatus, ThreadItem as AppItem},
        notifications::{
            ItemCompletedNotification, ItemStartedNotification, ThreadStartedNotification,
            TurnCompletedNotification, TurnStartedNotification,
        },
        thread::Thread,
        turn::{Turn, TurnStatus},
    },
};
use aphrody_exec_events::EventTranslator;

#[test]
fn test_full_turn_event_stream_to_jsonl() {
    let mut translator = EventTranslator::new();
    let mut jsonl_lines = Vec::new();

    // 1. Thread started
    let n1 = ServerNotification::ThreadStarted(ThreadStartedNotification {
        thread: Thread::new("th_demo_999", 1000),
    });
    for ev in translator.translate(&n1) {
        jsonl_lines.push(EventTranslator::to_jsonl(&ev).unwrap());
    }

    // 2. Turn started
    let n2 = ServerNotification::TurnStarted(TurnStartedNotification {
        turn: Turn {
            id: "turn_1".to_string(),
            thread_id: "th_demo_999".to_string(),
            status: TurnStatus::InProgress,
            items: Vec::new(),
            error: None,
        },
    });
    for ev in translator.translate(&n2) {
        jsonl_lines.push(EventTranslator::to_jsonl(&ev).unwrap());
    }

    // 3. Item started: command execution
    let n3 = ServerNotification::ItemStarted(ItemStartedNotification {
        thread_id: "th_demo_999".to_string(),
        turn_id: "turn_1".to_string(),
        started_at_ms: 1000,
        item: AppItem::CommandExecution {
            id: "cmd_1".to_string(),
            command: "git status".to_string(),
            cwd: ".".to_string(),
            status: CommandExecutionStatus::InProgress,
            aggregated_output: None,
            exit_code: None,
        },
    });
    for ev in translator.translate(&n3) {
        jsonl_lines.push(EventTranslator::to_jsonl(&ev).unwrap());
    }

    // 4. Item completed: command execution
    let n4 = ServerNotification::ItemCompleted(ItemCompletedNotification {
        thread_id: "th_demo_999".to_string(),
        turn_id: "turn_1".to_string(),
        completed_at_ms: 1010,
        item: AppItem::CommandExecution {
            id: "cmd_1".to_string(),
            command: "git status".to_string(),
            cwd: ".".to_string(),
            status: CommandExecutionStatus::Completed,
            aggregated_output: Some("On branch feat/codex-oss\nnothing to commit".to_string()),
            exit_code: Some(0),
        },
    });
    for ev in translator.translate(&n4) {
        jsonl_lines.push(EventTranslator::to_jsonl(&ev).unwrap());
    }

    // 5. Turn completed
    let n5 = ServerNotification::TurnCompleted(TurnCompletedNotification {
        turn: Turn {
            id: "turn_1".to_string(),
            thread_id: "th_demo_999".to_string(),
            status: TurnStatus::Completed,
            items: Vec::new(),
            error: None,
        },
    });
    for ev in translator.translate(&n5) {
        jsonl_lines.push(EventTranslator::to_jsonl(&ev).unwrap());
    }

    assert_eq!(jsonl_lines.len(), 5);

    // Verify TS SDK contract shape
    assert!(jsonl_lines[0].contains("\"type\":\"thread.started\""));
    assert!(jsonl_lines[1].contains("\"type\":\"turn.started\""));
    assert!(jsonl_lines[2].contains("\"type\":\"item.started\""));
    assert!(jsonl_lines[2].contains("\"type\":\"command_execution\""));
    assert!(jsonl_lines[3].contains("\"type\":\"item.completed\""));
    assert!(jsonl_lines[3].contains("\"status\":\"completed\""));
    assert!(jsonl_lines[4].contains("\"type\":\"turn.completed\""));
    assert!(jsonl_lines[4].contains("\"usage\":"));
}
