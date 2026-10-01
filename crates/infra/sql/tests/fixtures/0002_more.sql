-- SPDX-License-Identifier: Apache-2.0
ALTER TABLE widgets ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
CREATE INDEX widgets_name ON widgets (name);
