exec(open('graph.py').read())
import re
GUINAMES=set('''tauri tao wry winit tauri-winit tauri-winit-gtk4 tauri-winit-x11 tauri-winit-gtk gtk gtk4 gdk gdk4 webkit2gtk webkit6 wgpu wgpu-core wgpu-hal raw-window-handle accesskit accesskit_winit arboard rfd notify-rust tray-icon global-hotkey muda softbuffer slint iced egui eframe bevy vello cosmic-text parley skrifa tiny-skia wayland-client x11rb tauri-runtime tauri-runtime-wry tauri-runtime-cef cef wl-clipboard-rs ksni glutin sdl2 smithay tauri-plugin-clipboard-manager tauri-plugin-dialog tauri-plugin-notification tauri-plugin-global-shortcut tauri-plugin-window-state tauri-plugin-single-instance ratatui crossterm pixels minifb dioxus floem fltk cxx-qt relm4 skia-safe glow femtovg xilem masonry kurbo peniko taffy gpui windows objc2-app-kit webview2-com wkwebview'''.split())
def depkinds(n,dep):
    return {(k['kind'],k['target']) for k in dep['dep_kinds']}
def closure_kind(start, include=('normal',)):
    # follow only normal deps (kind None) from workspace crate ; build deps optionally
    seen={}
    st=[(start,None)]
    while st:
        x,via=st.pop()
        if x in seen: continue
        seen[x]=via
        n=nodes.get(x)
        if not n: continue
        for dep in n['deps']:
            ks={k['kind'] for k in dep['dep_kinds']}
            ok=False
            if None in ks and 'normal' in include: ok=True
            if 'build' in ks and 'build' in include: ok=True
            if 'dev' in ks and 'dev' in include and x==start: ok=True
            if ok: st.append((dep['pkg'],x))
    return seen
def short(i): 
    p=pk[i]; return f"{p['name']} {p['version']}"
def gui_hits(seen):
    out=collections.defaultdict(set)
    for i in seen:
        p=pk[i]
        if p['name'] in GUINAMES:
            out[p['name']].add(p['version'])
    return {k:sorted(v) for k,v in out.items()}
if __name__=='__main__':
    sel=lambda r:(r.startswith('crates/ui/') or r.startswith('crates/os/kernel') or r=='crates/contracts/subsystem' or r=='apps/cli')
    res={}
    for i in sorted(ws,key=lambda i:rel(pk[i])):
        r=rel(pk[i])
        if not sel(r) and not r.startswith('crates/koharu/'): continue
        p=pk[i]
        dirs=[]
        for dep in p['dependencies']:
            if dep['name'] in GUINAMES:
                dirs.append(f"{dep['name']}{'?' if dep['optional'] else ''}[{dep['kind'] or 'n'}{'@'+dep['target'] if dep.get('target') else ''}]")
        n=closure_kind(i,('normal',))
        nb=closure_kind(i,('normal','build'))
        print('##',r,p['name'],'normal_closure=',len(n),'with_build=',len(nb))
        print('  direct:',', '.join(dirs) or '-')
        print('  trans(normal):',gui_hits(n))
        extra=gui_hits(nb); 
        diff={k:v for k,v in extra.items() if k not in gui_hits(n)}
        if diff: print('  +build:',diff)
