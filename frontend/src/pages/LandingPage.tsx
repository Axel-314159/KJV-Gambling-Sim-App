import { Link } from 'react-router-dom';
import { LogIn, UserPlus, ArrowRight, ScrollText, Clock, ShieldCheck, Scale } from 'lucide-react';
import type { UserProfile } from '../types/api';

export function LandingPage({ user }: { user: UserProfile | null }) {
  return (
    <div className="space-y-10 pb-12">
      {/* Hero Banner */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 md:p-10">
        <div className="max-w-3xl space-y-4">
          <div className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
            Blind Scripture Gambling Simulator Game
          </div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-slate-100 tracking-tight">
            Jesus, Spin The Wheel!
          </h1>

          {/* === PASTE YOUR INTRO / GAME OVERVIEW PARAGRAPH HERE === */}
          <p className="text-base md:text-lg text-slate-300 leading-relaxed">
            Select passages from the 31,102 verses of the King James Bible, wager Shekels in daily blind rounds, and outmaneuver fellow players. Survive without a single overlapping verse to win your weighted share of the daily pot.
          </p>

          {/* Auth-Aware Call-to-Action Buttons */}
          <div className="pt-3 flex flex-wrap items-center gap-3">
            {user ? (
              <Link
                to="/arena"
                className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2.5 rounded-lg transition"
              >
                Enter Betting Arena
                <ArrowRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-5 py-2.5 rounded-lg transition"
                >
                  <LogIn className="w-4 h-4" />
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-semibold px-5 py-2.5 rounded-lg transition"
                >
                  <UserPlus className="w-4 h-4" />
                  Request Account
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Main Content Sections (Replace or expand these blocks with your typed rules) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Section 1: How It Works */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400">
            <ScrollText className="w-5 h-5" />
            <h2 className="text-xl font-semibold text-slate-100">How It Works</h2>
          </div>
          {/* === PASTE YOUR "HOW IT WORKS" CONTENT HERE === */}
          <div className="text-sm text-slate-300 space-y-2.5 leading-relaxed">
            <p>
              Each round spans the canonical King James Version from Genesis 1:1 through Revelation 22:21. Registered players select one or more continuous segments of complete verses and place a Shekel wager on each segment.
            </p>
            <p>
              All selections remain strictly hidden until the round closes. When the round settles, any two players whose segments overlap by even a single verse collide—and both forfeit the stakes on those colliding segments.
            </p>
          </div>
        </section>

        {/* Section 2: Daily Schedule */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400">
            <Clock className="w-5 h-5" />
            <h2 className="text-xl font-semibold text-slate-100">Daily Schedule</h2>
          </div>
          {/* === PASTE YOUR SCHEDULE DETAILS HERE === */}
          <div className="text-sm text-slate-300 space-y-2.5 leading-relaxed">
            <p>
              <strong className="text-slate-100">Registration Window:</strong> Opens immediately after the previous round closes (default 20:00 ET) and stays open until betting begins. You must register before betting opens to participate in that day&apos;s round.
            </p>
            <p>
              <strong className="text-slate-100">Betting Window:</strong> Opens daily (default 08:00–20:00 ET). Once you submit your initial slip, you are permitted <strong>one revision</strong> before the deadline.
            </p>
          </div>
        </section>

        {/* Section 3: Segment Rules & Limits */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400">
            <ShieldCheck className="w-5 h-5" />
            <h2 className="text-xl font-semibold text-slate-100">Rules &amp; Limits</h2>
          </div>
          {/* === PASTE YOUR RULES & LIMITS HERE === */}
          <div className="text-sm text-slate-300 space-y-2.5 leading-relaxed">
            <p>
              Approved accounts begin with a starting grant of <strong className="text-amber-300">~100 Shekels</strong>. Each round sets minimum and maximum limits on segment length, number of discrete segments per slip, and minimum Shekels staked per verse.
            </p>
            <p>
              Your total combined verse budget adapts dynamically based on the number of players registered for the round, and your own segments within a slip may never overlap one another.
            </p>
          </div>
        </section>

        {/* Section 4: Scoring & Payouts */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400">
            <Scale className="w-5 h-5" />
            <h2 className="text-xl font-semibold text-slate-100">Winnings &amp; Payouts</h2>
          </div>
          {/* === PASTE YOUR PAYOUT EXPLANATION HERE === */}
          <div className="text-sm text-slate-300 space-y-2.5 leading-relaxed">
            <p>
              Every segment that finishes the round with zero collisions survives and splits the round&apos;s total pot proportionally to the product of its wagered stake and verse length.
            </p>
            <p>
              If every segment in a round collides and no winners remain, all players have their wagers refunded in full.
            </p>
            <p>
              <strong className="text-amber-300">Jackpot Verses:</strong> A secret segment of verse is chosen at random. If one of your winning segments completely contains the jackpot verses, you win the running jackpot!
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}