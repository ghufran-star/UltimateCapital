/** Shown the instant you tap a menu item, while the page loads. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="skel h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skel h-20" />
        ))}
      </div>
      <div className="skel h-64" />
      <div className="skel h-40" />
    </div>
  );
}
