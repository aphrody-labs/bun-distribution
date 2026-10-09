// SPDX-License-Identifier: Apache-2.0
import React, { useState, useEffect } from 'react';

interface VfsEntry {
  name: string;
  type: 'dir' | 'file' | 'socket' | 'link';
  size: string;
  perms: string;
  modified: string;
  hash?: string;
  mime?: string;
  path?: string;
}

export const SpacedriveVfsApp: React.FC = () => {
  const [currentPath, setCurrentPath] = useState('/work');
  const [selectedEntry, setSelectedEntry] = useState<VfsEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeVolume, setActiveVolume] = useState('nvme');
  const [liveEntries, setLiveEntries] = useState<VfsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [readingFile, setReadingFile] = useState(false);

  const volumes = [
    { id: 'nvme', name: 'System NVMe', mount: '/', total: '1.8 TB', free: '1.4 TB', icon: '💾', type: 'ext4' },
    { id: 'ram', name: 'ZSwap RAMDisk', mount: '/dev/shm', total: '32 GB', free: '29 GB', icon: '⚡', type: 'tmpfs' },
    { id: 'cloud', name: 'Aphrody S3 Cloud', mount: 's3://aphrody-vault', total: '10 TB', free: '7.8 TB', icon: '☁️', type: 's3' },
    { id: 'cold', name: 'Cold Storage Vault', mount: '/mnt/cold', total: '4 TB', free: '3.9 TB', icon: '🔒', type: 'zfs' },
  ];

  const tags = [
    { name: 'Core Crates', count: 18, color: 'bg-purple-500' },
    { name: 'UI & M3', count: 24, color: 'bg-indigo-500' },
    { name: 'Alpine APKs', count: 12, color: 'bg-blue-500' },
    { name: 'Models & Weights', count: 6, color: 'bg-emerald-500' },
    { name: 'Security Keys', count: 4, color: 'bg-amber-500' },
  ];

  const fallbackEntriesByPath: Record<string, VfsEntry[]> = {
    '/': [
      { name: 'bin', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:00' },
      { name: 'etc', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:00' },
      { name: 'lib', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:00' },
      { name: 'proc', type: 'dir', size: '0 B', perms: 'r-xr-xr-x', modified: '2026-10-09 03:00' },
      { name: 'sys', type: 'dir', size: '0 B', perms: 'r-xr-xr-x', modified: '2026-10-09 03:00' },
      { name: 'var', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:00' },
      { name: 'work', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:15' },
    ],
    '/work': [
      { name: 'crates', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:10' },
      { name: 'm3', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:18' },
      { name: 'packages', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:12' },
      { name: 'apps', type: 'dir', size: '4.0 KB', perms: 'rwxr-xr-x', modified: '2026-10-09 03:22' },
      { name: 'Cargo.toml', type: 'file', size: '14.2 KB', perms: 'rw-r--r--', modified: '2026-10-09 03:00', hash: 'wy:8f2a9c14', mime: 'text/x-toml' },
      { name: 'package.json', type: 'file', size: '14.1 KB', perms: 'rw-r--r--', modified: '2026-10-09 03:20', hash: 'wy:3e81bd99', mime: 'application/json' },
      { name: 'bun.lock', type: 'file', size: '412 KB', perms: 'rw-r--r--', modified: '2026-10-09 03:15', hash: 'wy:c4b91012', mime: 'text/plain' },
    ],
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/os/vfs/list?path=${encodeURIComponent(currentPath)}&volume=${activeVolume}`)
      .then(res => res.json())
      .then(data => {
        if (active && data.entries && data.entries.length > 0) {
          setLiveEntries(data.entries);
        } else if (active) {
          setLiveEntries(fallbackEntriesByPath[currentPath] || []);
        }
      })
      .catch(() => {
        if (active) setLiveEntries(fallbackEntriesByPath[currentPath] || []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [currentPath, activeVolume]);

  const currentEntries = liveEntries.length > 0 ? liveEntries : (fallbackEntriesByPath[currentPath] || []);
  const filteredEntries = searchQuery
    ? currentEntries.filter(e => e.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : currentEntries;

  const navigateTo = (dirName: string) => {
    setFileContent(null);
    if (dirName === '..') {
      const parts = currentPath.split('/').filter(Boolean);
      parts.pop();
      setCurrentPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
      setSelectedEntry(null);
    } else {
      const newPath = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`;
      setCurrentPath(newPath);
      setSelectedEntry(null);
    }
  };

  const handleOpenStream = async (entry: VfsEntry) => {
    setReadingFile(true);
    try {
      const targetPath = entry.path || (currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`);
      const res = await fetch(`/api/os/vfs/read?path=${encodeURIComponent(targetPath)}`);
      if (res.ok) {
        const data = await res.json();
        setFileContent(data.content || '');
      } else {
        setFileContent(`[Could not read file stream: ${entry.name}]`);
      }
    } catch (e: any) {
      setFileContent(`[Stream error: ${e.message}]`);
    } finally {
      setReadingFile(false);
    }
  };

  return (
    <div className="flex h-full bg-[#0e1017] text-gray-200 font-sans select-none overflow-hidden">
      {/* Volumes & Tags Sidebar */}
      <div className="w-56 bg-[#131620] border-r border-gray-800 flex flex-col shrink-0">
        <div className="p-3 border-b border-gray-800/80">
          <div className="flex items-center gap-2 font-semibold text-xs tracking-wider text-purple-300 uppercase">
            <span>Spacedrive VFS</span>
            <span className="text-[10px] bg-purple-500/20 text-purple-400 px-1.5 py-0.2 rounded font-mono">vfs-core</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-4 text-xs custom-scrollbar">
          <div>
            <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Volumes</div>
            <div className="space-y-0.5 mt-1">
              {volumes.map(vol => (
                <button
                  key={vol.id}
                  onClick={() => setActiveVolume(vol.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-left transition-colors ${
                    activeVolume === vol.id
                      ? 'bg-purple-600/20 text-purple-300 font-medium'
                      : 'hover:bg-gray-800/50 text-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span>{vol.icon}</span>
                    <span className="truncate">{vol.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-gray-500">{vol.free}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="px-2 py-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Tag Closures</div>
            <div className="space-y-0.5 mt-1">
              {tags.map(tag => (
                <div
                  key={tag.name}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-gray-800/40 text-gray-400 cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${tag.color}`} />
                    <span>{tag.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-gray-500">{tag.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-2 border-t border-gray-800 bg-[#10121a] text-[11px] text-gray-400 font-mono flex items-center justify-between">
          <span>fsindex (Everything):</span>
          <span className="text-emerald-400 font-bold">&lt;0.8ms</span>
        </div>
      </div>

      {/* Main Files View */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Navigation & Search toolbar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#141722] border-b border-gray-800 gap-3">
          <div className="flex items-center gap-2 text-xs font-mono text-gray-300 flex-1 overflow-x-auto whitespace-nowrap">
            {currentPath !== '/' && (
              <button
                onClick={() => navigateTo('..')}
                className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold"
                title="Go up"
              >
                ↑
              </button>
            )}
            <div className="flex items-center gap-1 bg-gray-900/80 px-2 py-1 rounded border border-gray-800">
              <span className="text-purple-400">rootfs:</span>
              <span>{currentPath}</span>
            </div>
          </div>

          <div className="w-64">
            <input
              type="text"
              placeholder="Fast search (fsindex)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-gray-900 border border-gray-800 rounded px-2.5 py-1 text-xs text-gray-200 outline-none focus:border-purple-500 font-mono"
            />
          </div>
        </div>

        {/* Entries Table */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <table className="w-full text-left text-xs font-mono">
            <thead className="text-[11px] text-gray-500 uppercase border-b border-gray-800/80">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Size</th>
                <th className="pb-2 font-medium">Permissions</th>
                <th className="pb-2 font-medium">Checksum (wyhash)</th>
                <th className="pb-2 font-medium">Modified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/40">
              {filteredEntries.map(entry => (
                <tr
                  key={entry.name}
                  onClick={() => setSelectedEntry(entry)}
                  onDoubleClick={() => entry.type === 'dir' && navigateTo(entry.name)}
                  className={`cursor-pointer transition-colors ${
                    selectedEntry?.name === entry.name
                      ? 'bg-purple-600/20 text-white'
                      : 'hover:bg-gray-800/40 text-gray-300'
                  }`}
                >
                  <td className="py-2 flex items-center gap-2 font-sans font-medium">
                    <span className="text-base">
                      {entry.type === 'dir' ? '📁' : entry.mime?.includes('json') ? '📋' : '📄'}
                    </span>
                    <span>{entry.name}</span>
                  </td>
                  <td className="py-2 text-gray-400">{entry.size}</td>
                  <td className="py-2 text-gray-500">{entry.perms}</td>
                  <td className="py-2 text-purple-400/80 font-bold">{entry.hash || '—'}</td>
                  <td className="py-2 text-gray-500">{entry.modified}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspector Panel */}
      {selectedEntry && (
        <div className="w-72 bg-[#12151f] border-l border-gray-800 p-4 flex flex-col shrink-0 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-gray-800">
            <span className="font-semibold text-gray-200">File Inspector</span>
            <button
              onClick={() => setSelectedEntry(null)}
              className="text-gray-500 hover:text-gray-300"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 flex flex-col items-center p-4 bg-gray-900/60 rounded-lg border border-gray-800/80">
            <span className="text-4xl mb-2">{selectedEntry.type === 'dir' ? '📁' : '📄'}</span>
            <span className="font-semibold text-gray-100 text-center break-all">{selectedEntry.name}</span>
            <span className="text-[11px] text-gray-500 font-mono mt-1">{selectedEntry.type.toUpperCase()}</span>
          </div>

          <div className="mt-4 space-y-2.5 font-mono text-[11px]">
            <div>
              <span className="text-gray-500 block">Size:</span>
              <span className="text-gray-200 font-bold">{selectedEntry.size}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Permissions:</span>
              <span className="text-gray-200">{selectedEntry.perms}</span>
            </div>
            {selectedEntry.hash && (
              <div>
                <span className="text-gray-500 block">wyhash Checksum:</span>
                <span className="text-purple-300 font-bold break-all">{selectedEntry.hash}</span>
              </div>
            )}
            {selectedEntry.mime && (
              <div>
                <span className="text-gray-500 block">MIME Type:</span>
                <span className="text-gray-300">{selectedEntry.mime}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500 block">Last Modified:</span>
              <span className="text-gray-400">{selectedEntry.modified}</span>
            </div>
          </div>

          {/* Stream Preview */}
          {fileContent !== null && (
            <div className="mt-3 flex-1 flex flex-col min-h-0 bg-gray-950 p-2.5 rounded border border-purple-500/30">
              <div className="flex items-center justify-between text-[10px] text-purple-300 font-mono pb-1 border-b border-gray-800">
                <span>VFS Stream ({selectedEntry.name})</span>
                <button onClick={() => setFileContent(null)} className="text-gray-500 hover:text-gray-300">✕</button>
              </div>
              <pre className="flex-1 overflow-y-auto font-mono text-[10px] text-gray-300 mt-1 whitespace-pre-wrap select-text custom-scrollbar">
                {fileContent}
              </pre>
            </div>
          )}

          <div className="mt-auto pt-3 border-t border-gray-800 flex gap-2">
            <button
              onClick={() => handleOpenStream(selectedEntry)}
              disabled={readingFile || selectedEntry.type === 'dir'}
              className="flex-1 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded font-medium text-xs transition-colors"
            >
              {readingFile ? 'Reading...' : 'Open Stream'}
            </button>
            <button
              onClick={() => {
                const text = selectedEntry.hash || selectedEntry.name;
                navigator.clipboard?.writeText?.(text);
              }}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs"
              title="Copy hash"
            >
              Copy
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
