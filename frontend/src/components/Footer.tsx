export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-800 bg-slate-900/90 text-slate-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>
            &copy; {currentYear} Jesus Spin The Wheel. All rights reserved.
        </p>
      </div>
    </footer>
  );
}