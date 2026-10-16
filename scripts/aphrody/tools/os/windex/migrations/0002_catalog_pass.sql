-- SPDX-License-Identifier: Apache-2.0
-- windex schema v2: the catalog-signature lookup becomes a deferred pass. `catalog_checked` is false for images
-- without an embedded signature until the pass looked them up; images already resolved stay checked.

ALTER TABLE windex.pe ADD COLUMN catalog_checked boolean NOT NULL DEFAULT false;
UPDATE windex.pe SET catalog_checked = true WHERE signature <> 'none';
CREATE INDEX pe_catalog_pending ON windex.pe (node_id) WHERE NOT catalog_checked;
