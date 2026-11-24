export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-800 bg-slate-900/90 text-slate-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>
          &copy; {currentYear} Jesus Spin The Wheel Ultd.
          &nbsp;&nbsp; • &nbsp;&nbsp;
          This web application by Jesus Spin The Wheel Ultd. is licensed under&nbsp;
          <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
          &nbsp;&nbsp; • &nbsp;&nbsp;
          <a href="https://github.com/Axel-314159/KJV-Gambling-Sim-App/">Source code on GitHub (GPL-3.0)</a>
        </p>
      </div>
    </footer>
  );
}