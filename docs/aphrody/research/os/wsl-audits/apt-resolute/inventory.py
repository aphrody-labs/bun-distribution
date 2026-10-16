import lzma,pathlib,json,subprocess
root=pathlib.Path(__file__).parent
names='build-essential git ca-certificates curl wget pkg-config cmake ninja-build clang llvm lld libclang-dev rustc cargo rustup systemd systemd-sysv dbus dbus-user-session udev sudo util-linux iproute2 iputils-ping dnsutils openssh-client openssh-server nftables ethtool socat netcat-openbsd usbip linux-tools-generic pciutils usbutils udisks2 smartmontools nvme-cli e2fsprogs dosfstools qemu-utils debootstrap mmdebstrap squashfs-tools xz-utils cpio bison flex libelf-dev dwarves bc libncurses-dev libssl-dev libudev-dev libdbus-1-dev libwayland-dev wayland-protocols libxkbcommon-dev libgbm-dev libegl1-mesa-dev libvulkan-dev vulkan-tools mesa-utils mesa-vulkan-drivers libpipewire-0.3-dev pipewire wireplumber libpulse-dev pulseaudio libasound2-dev libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev bind9-dnsutils linux-tools-common libayatana-appindicator3-dev podman docker.io crun slirp4netns fuse-overlayfs jq ripgrep fd-find bat eza zoxide sccache nushell librust-tokio-dev librust-serde-dev librust-clap-dev librust-nix-dev librust-notify-dev librust-rusqlite-dev librust-reqwest-dev'.split()
indices={}
for component in ['main','universe']:
 data=lzma.open(root/f'{component}-Packages.xz','rt').read()
 for block in data.split('\n\n'):
  fields={}
  for line in block.splitlines():
   if line and not line.startswith(' ') and ': ' in line:
    k,v=line.split(': ',1);fields[k]=v
  if fields.get('Package') in names:indices[fields['Package']]={k:fields.get(k,'') for k in ['Version','Section','Homepage','Source']};indices[fields['Package']]['Component']=component
result=[]
for name in names:
 q=subprocess.run(['dpkg-query','-W','-f=${db:Status-Status}\t${Version}\n',name],capture_output=True,text=True)
 vals=[line.split('\t') for line in q.stdout.splitlines()];installed=next((val[1] for val in vals if len(val)==2 and val[0]=='installed'),'')
 noble=subprocess.run(['apt-cache','policy',name],capture_output=True,text=True).stdout
 candidate=next((x.split(':',1)[1].strip() for x in noble.splitlines() if 'Candidate:' in x),'')
 result.append({'package':name,'installedNoble':installed,'candidateNoble':candidate,'resolute':indices.get(name)})
(root/'inventory.json').write_text(json.dumps(result,indent=2)+'\n')
print('Packages',len(result),'installed',sum(bool(x['installedNoble']) for x in result),'Resolute main/universe found',sum(x['resolute'] is not None for x in result))
for name in ['rustc','cargo','rustup','nushell','sccache','librust-tokio-dev','libwebkit2gtk-4.1-dev','libappindicator3-dev']:
 print(next(x for x in result if x['package']==name))
