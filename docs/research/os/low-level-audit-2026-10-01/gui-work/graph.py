import json, collections, sys
d=json.load(open('/tmp/stack-dedup/metadata-after.json'))
pk={p['id']:p for p in d['packages']}
nodes={n['id']:n for n in d['resolve']['nodes']}
ws=set(d['workspace_members'])
root=d['workspace_root']
def rel(p):
    m=p['manifest_path']
    return m.replace(root+'/','').replace('/Cargo.toml','')
# map by path
ws_pk={i:pk[i] for i in ws}
GUI=['tauri','tao','wry','winit','tauri-winit','gtk','gtk4','gdk','gdk4','gtk-sys','webkit2gtk','wgpu','wgpu-core','wgpu-hal','raw-window-handle','accesskit','arboard','rfd','notify-rust','tray-icon','global-hotkey','muda','softbuffer','slint','iced','egui','eframe','bevy','vello','cosmic-text','parley','skrifa','tiny-skia','wayland-client','x11rb','windows','objc2-app-kit','cocoa','tauri-runtime','tauri-runtime-wry','tauri-runtime-cef','cef','wl-clipboard-rs','zbus','ksni','glutin','sdl2','smithay','accesskit_winit','winit-gtk','gpui','ratatui','crossterm','tauri-plugin-clipboard-manager','tauri-plugin-dialog','tauri-plugin-notification','tauri-plugin-global-shortcut','tauri-plugin-window-state','tauri-plugin-single-instance','pixels','minifb','druid','makepad','dioxus','floem','fltk','cxx-qt','relm4','skia-safe','glow','femtovg','kurbo','peniko','xilem','masonry','taffy','cosmic']
def closure(start):
    seen=set(); st=[start]
    while st:
        x=st.pop()
        if x in seen: continue
        seen.add(x)
        n=nodes.get(x)
        if not n: continue
        for dep in n['deps']:
            # include dev/build? track kinds
            st.append(dep['pkg'])
    return seen
def kinds(n):
    pass
def direct(pid):
    p=pk[pid]
    return [(dep['name'],dep.get('kind'),dep.get('optional'),dep.get('target'),dep['req'],dep.get('features')) for dep in p['dependencies']]
if __name__=='__main__':
    pass
