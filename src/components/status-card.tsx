interface StatusCardProps {
  title: string;
  value: string;
  valueColor?: string;
  detail?: string;
  action?: {
    label: string;
    href: string;
  };
}

export function StatusCard({ title, value, valueColor = 'text-zinc-100', detail, action }: StatusCardProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-zinc-400 mb-2">{title}</h2>
      <p className={`text-2xl font-semibold ${valueColor}`}>{value}</p>
      {detail && <p className="text-xs text-zinc-500 mt-2">{detail}</p>}
      {action && (
        <a
          href={action.href}
          className="inline-block mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}
