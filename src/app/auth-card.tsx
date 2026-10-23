export default function AuthCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <img src="/icon.svg" alt="" className="h-9 w-9" />
        <span className="text-lg font-semibold">UltimateCapital</span>
      </div>
      <div className="card space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
