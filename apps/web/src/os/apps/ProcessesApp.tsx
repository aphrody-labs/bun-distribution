// SPDX-License-Identifier: Apache-2.0
/** Processus: wasm workers started by the WebOS, with kill. */
import React, { useEffect, useState } from "react";
import { processes, type ProcessInfo } from "../wasm/client";

export const ProcessesApp: React.FC = () => {
  const [list, setList] = useState<ProcessInfo[]>([]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => processes.subscribe(setList), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="h-full overflow-auto bg-[#0f1117] p-3 text-sm text-gray-100">
      <table className="w-full font-mono text-xs">
        <thead className="text-left text-gray-400">
          <tr>
            <th>PID</th>
            <th>Nom</th>
            <th>Module</th>
            <th>Durée</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map(p => (
            <tr key={p.pid} className="border-t border-gray-800">
              <td className="py-1">{p.pid}</td>
              <td>{p.name}</td>
              <td className="text-gray-400">{p.module}</td>
              <td>{Math.round((now - p.startedAt) / 1000)} s</td>
              <td>
                <button className="text-red-400 hover:underline" onClick={() => processes.kill(p.pid)}>
                  kill
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <div className="mt-6 text-center text-xs text-gray-500">Aucun module wasm actif</div>}
    </div>
  );
};
