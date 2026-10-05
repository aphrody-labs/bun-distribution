export function AdminHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex items-end justify-between flex-wrap gap-4">
      <div>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2 uppercase">{title}</h1>
        {subtitle && (
          <p className="text-xs text-dbz-blue-light uppercase tracking-widest">{subtitle}</p>
        )}
      </div>
      {right && <div>{right}</div>}
    </header>
  );
}
