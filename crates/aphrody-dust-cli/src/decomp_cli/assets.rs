// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Aetias
//! Required build assets from the integrated ds-decomp fork.
//! Source: https://github.com/AetiasHax/ds-decomp/tree/c4080635ac38aaf9608ca23751defa9fa19cf81a/assets
//! License notice: docs/licenses/dsd/LICENSE.

pub const ARM9_LCF_TEMPLATE: &str = r###"MEMORY \{
    {{ for module in modules -}}
    {module.name} : ORIGIN = {module.origin} > {module.output_file}
    {{ endfor }}
    SPACE : ORIGIN = AFTER(
        {{- for module in modules -}}
            {{- if not module.in_tcm -}}
                {{- if not @first -}}, {{ endif -}}
                {module.name}
            {{- endif -}}
        {{- endfor -}}
    )
}

KEEP_SECTION \{
    .init,
    .ctor,
    .exceptix
}

SECTIONS \{
    {{ for overlay in overlays -}}
    {overlay.id_symbol} = {overlay.id};
    {{ endfor }}

    {{ for variable in variables -}}
    {variable.symbol} = {variable.value};
    {{ endfor }}

    {{ for module in modules -}}
    {module.link_section} : \{
        ALIGNALL(4);
        {{ for section in module.sections -}}
        . = ALIGN({section.alignment});
        {section.start_symbol} = .;
        {{ for file in section.files -}}
        {file.name}({file.section_name})
        {{ endfor }}
        {{ if section.append_zero }}WRITEW(0);{{ endif }}
        {{ if section.exceptix }}EXCEPTION{{ endif }}
        . = ALIGN({section.end_alignment});
        {section.end_symbol} = .;
        {{ endfor }}
    } > {module.name}

    {{ endfor }}
}
"###;

pub const FS_LOAD_OVERLAY: &str = r###"name: FS_LoadOverlay
signatures:
- bitmask: ////////////////APgA+P///////wD4APj///////////////8A+AD4////////
  pattern: ALWLsAMcChwAqBkcAPAA+AAoBNAAqADwAPgAKALRC7AAIAC9AKgA8AD4ASALsAC9
  relocations:
  - offset: 12
    name: FS_LoadOverlayInfo
    kind: ThumbCall
  - offset: 22
    name: FS_LoadOverlayFile
    kind: ThumbCall
  - offset: 38
    name: FS_StartOverlay
    kind: ThumbCall
- bitmask: ////////////////////////////////AAAA/////////////////wAAAP//////////////////////////////////////AAAA//////////////////////8=
  pattern: AEAt6SzQTeIAMKDhASCg4QAAjeIDEKDhAAAA6wAAUOMDAAAKAACN4gAAAOsAAFDjAwAAGizQjeIAAKDjAEC96B7/L+EAAI3iAAAA6wEAoOMs0I3iAEC96B7/L+E=
  relocations:
  - offset: 24
    name: FS_LoadOverlayInfo
    kind: ArmCall
  - offset: 40
    name: FS_LoadOverlayFile
    kind: ArmCall
  - offset: 72
    name: FS_StartOverlay
    kind: ArmCall
- bitmask: ////////////////////////////////AAAA/////////////////wAAAP////////////////////////////////8AAAD/////////////////
  pattern: AEAt6SzQTeIAMKDhASCg4QAAjeIDEKDhAAAA6wAAUOMDAAAKAACN4gAAAOsAAFDjAgAAGizQjeIAAKDjAIC96AAAjeIAAADrAQCg4yzQjeIAgL3o
  relocations:
  - offset: 24
    name: FS_LoadOverlayInfo
    kind: ArmCall
  - offset: 40
    name: FS_LoadOverlayFile
    kind: ArmCall
  - offset: 68
    name: FS_StartOverlay
    kind: ArmCall
- bitmask: /////////////////////////////////////wAAAP////////////////8AAAD/////////////////////////////////AAAA/////////////////w==
  pattern: GEAt6SzQTeIAQI3iADCg4QEgoOEEAKDhAxCg4QAAAOsAAFDjAwAACgQAoOEAAADrAABQ4wIAABos0I3iAACg4xiAvegEAKDhAAAA6wEAoOMs0I3iGIC96A==
  relocations:
  - offset: 28
    name: FS_LoadOverlayInfo
    kind: ArmCall
  - offset: 44
    name: FS_LoadOverlayFile
    kind: ArmCall
  - offset: 72
    name: FS_StartOverlay
    kind: ArmCall
"###;

pub const FS_UNLOAD_OVERLAY: &str = r###"name: FS_UnloadOverlay
signatures:
- bitmask: ////////////////APgA+P///////wD4APj/////////////////////
  pattern: ALWLsAMcChwAqBkcAPAA+AAoBNAAqADwAPgAKALRC7AAIAC9ASALsAC9
  relocations:
  - offset: 12
    name: FS_LoadOverlayInfo
    kind: ThumbCall
  - offset: 22
    name: FS_StopOverlay
    kind: ThumbCall
- bitmask: ////////////////////////////////AAAA/////////////////wAAAP///////////////////////////////////////////w==
  pattern: AEAt6SzQTeIAMKDhASCg4QAAjeIDEKDhAAAA6wAAUOMDAAAKAACN4gAAAOsAAFDjAgAAGizQjeIAAKDjAIC96AEAoOMs0I3iAIC96A==
  relocations:
  - offset: 24
    name: FS_LoadOverlayInfo
    kind: ArmCall
  - offset: 40
    name: FS_StopOverlay
    kind: ArmCall
- bitmask: ////////////////////////////////AAAA/////////////////wAAAP//////////////////////////////////////////////////////
  pattern: AEAt6SzQTeIAMKDhASCg4QAAjeIDEKDhAAAA6wAAUOMDAAAKAACN4gAAAOsAAFDjAwAAGizQjeIAAKDjAEC96B7/L+EBAKDjLNCN4gBAvege/y/h
  relocations:
  - offset: 24
    name: FS_LoadOverlayInfo
    kind: ArmCall
  - offset: 40
    name: FS_StopOverlay
    kind: ArmCall
- bitmask: /////////////////////////////////////wAAAP////////////////8AAAD///////////////////////////////////////////8=
  pattern: GEAt6SzQTeIAQI3iADCg4QEgoOEEAKDhAxCg4QAAAOsAAFDjAwAACgQAoOEAAADrAABQ4wIAABos0I3iAACg4xiAvegBAKDjLNCN4hiAveg=
  relocations:
  - offset: 28
    name: FS_LoadOverlayInfo
    kind: ArmCall
  - offset: 44
    name: FS_StopOverlay
    kind: ArmCall
"###;

#[cfg(test)]
mod tests {
    #[test]
    fn integrated_signatures_parse_with_the_runtime_loader() {
        let signatures = crate::analysis::signature::Signatures::list().unwrap();
        let names: Vec<_> = signatures.iter().map(|signature| signature.name()).collect();
        assert_eq!(names, ["FS_LoadOverlay", "FS_UnloadOverlay"]);
    }

    #[test]
    fn integrated_arm9_template_parses() {
        let mut templates = tinytemplate::TinyTemplate::new();
        templates.add_template("arm9", super::ARM9_LCF_TEMPLATE).unwrap();
    }
}
