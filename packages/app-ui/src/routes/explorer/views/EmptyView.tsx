export function EmptyView() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center p-6 rounded-large bg-surface-container-low border border-outline-variant/40 shadow-xs max-w-sm">
        <div className="text-on-surface-variant text-body-large">
          Sélectionnez un emplacement ou un volume dans la barre latérale pour explorer vos fichiers
        </div>
      </div>
    </div>
  );
}
