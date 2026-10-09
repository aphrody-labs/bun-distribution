// SPDX-License-Identifier: Apache-2.0
//! Form field models and validation shared by browser and native adapters.

pub use crate::components::{FieldError, TextField};

#[cfg(test)]
mod tests {
    use super::{FieldError, TextField};

    #[test]
    fn optional_empty_field_is_valid() {
        let field = TextField {
            id: "nickname".into(),
            label: "Nickname".into(),
            value: String::new(),
            required: false,
            enabled: true,
        };
        assert_eq!(field.validate(), Ok(()));
        assert_ne!(field.validate(), Err(FieldError::Required));
    }
}
