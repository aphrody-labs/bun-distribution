-- SPDX-License-Identifier: MIT
-- User-level override that enters the package-installed Omarchy defaults.
-- OMARCHY_PATH is derived from the installed package file list at startup.
local omarchy = assert(os.getenv("OMARCHY_PATH"), "OMARCHY_PATH was not resolved")
dofile(omarchy .. "/default/hypr/bootstrap.lua")
