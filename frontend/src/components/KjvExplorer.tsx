import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Search, ChevronLeft, ChevronRight, ChevronDown, X, AlertCircle, AlertTriangle, BookOpenText } from 'lucide-react';
import { ApiError, apiFetch } from '../lib/api';
import type { AutoSelectRequest, KjvBookMeta, KjvVerse, ActiveRoundState, KjvSection } from '../types/api';

interface KjvExplorerProps {
  isSlipLocked: boolean;
  maxVerses: number;
  minSegmentLength: number;
  maxSegmentLength: number;
  minSegments: number;
  maxSegments: number;
  onAddSegment: (start: KjvVerse, end: KjvVerse) => void;
  onAutoSelect: (req: AutoSelectRequest) => void;
  isAutoSelecting: boolean;
}

interface KjvExplorerMiniProps {
  startBook: number;
  endBook: number;
  onStartBookChange: (bookNumber: number) => void;
  onEndBookChange: (bookNumber: number) => void;
}


export function KjvExplorer({
  isSlipLocked,
  maxVerses,
  minSegmentLength,
  maxSegmentLength,
  minSegments,
  maxSegments,
  onAddSegment,
  onAutoSelect,
  isAutoSelecting,
}: KjvExplorerProps) {
  const [selectedBookNumber, setSelectedBookNumber] = useState<number>(1);
  const [selectedChapter, setSelectedChapter] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedStart, setSelectedStart] = useState<KjvVerse | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<KjvVerse | null>(null);
  const [showAutoSelect, setShowAutoSelect] = useState<boolean>(false);

  // Custom dropdown state
  const [openMenu, setOpenMenu] = useState<'BOOK' | 'CHAPTER' | null>(null);
  const [bookFilter, setBookFilter] = useState<string>('');
  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const {
    data: books,
    isLoading: isLoadingBooks,
    isError: isBooksError,
    error: booksError,
  } = useQuery<KjvBookMeta[]>({
    queryKey: ['kjvBooks'],
    queryFn: () => apiFetch<KjvBookMeta[]>('/kjv/books'),
    staleTime: Infinity,
  });

  const currentBook = books?.find((b) => b.bookNumber === selectedBookNumber);
  const isSearching = searchQuery.trim().length >= 3;

  const {
    data: chapterVerses,
    isLoading: isLoadingChapter,
    isError: isChapterError,
    error: chapterError,
  } = useQuery<KjvVerse[]>({
    queryKey: ['kjvChapter', selectedBookNumber, selectedChapter],
    queryFn: () =>
      apiFetch<KjvVerse[]>(`/kjv/books/${selectedBookNumber}/chapters/${selectedChapter}`),
    enabled: !isSearching,
    staleTime: Infinity,
  });

  const { data: searchResults, isLoading: isLoadingSearch } = useQuery<KjvVerse[]>({
    queryKey: ['kjvSearch', searchQuery],
    queryFn: () => apiFetch<KjvVerse[]>(`/kjv/search?q=${encodeURIComponent(searchQuery)}`),
    enabled: isSearching,
  });

  const { data: state } = useQuery<ActiveRoundState>({
    queryKey: ['roundState'],
    queryFn: () => apiFetch<ActiveRoundState>(`/rounds/current`),
    refetchInterval: 15_000,
  });


  const hasHydratedRoundState = useRef(false);

  // initialize navigator from server
  useEffect(() => {
    if (state && !hasHydratedRoundState.current ) {
      setSelectedBookNumber(state.round.startBook ?? 1);
      hasHydratedRoundState.current = true;
    }
  }, [state]);


  const displayedVerses = isSearching ? searchResults : chapterVerses;
  const isLoadingVerses = isSearching ? isLoadingSearch : isLoadingChapter;

  const stagedStartId =
    selectedStart && selectedEnd
      ? Math.min(selectedStart.verseId, selectedEnd.verseId)
      : selectedStart?.verseId ?? null;
  const stagedEndId =
    selectedStart && selectedEnd
      ? Math.max(selectedStart.verseId, selectedEnd.verseId)
      : selectedEnd?.verseId ?? null;
  const stagedLength =
    stagedStartId !== null && stagedEndId !== null ? stagedEndId - stagedStartId + 1 : null;

  const isStagedLengthValid =
    stagedLength !== null &&
    stagedLength >= minSegmentLength &&
    stagedLength <= maxSegmentLength;

  const isBookIncluded = (bookNum: number) => {
    if (state?.round.startBook && state?.round.endBook) {
      const lower = Math.min(state?.round.startBook, state?.round.endBook);
      const upper = Math.max(state?.round.startBook, state?.round.endBook);
      return (bookNum <= upper && bookNum >= lower);
    } else {
      return true;
    }
  };

  const handleBookChange = (newBookNum: number) => {
    setSelectedBookNumber(newBookNum);
    setSelectedChapter(1);
    setSearchQuery('');
    setBookFilter('');
    setOpenMenu(null);
  };

  const handleChapterChange = (newChapter: number) => {
    setSelectedChapter(newChapter);
    setSearchQuery('');
    setOpenMenu(null);
  };

  const handlePrevChapter = () => {
    if (selectedChapter > 1) {
      setSelectedChapter((c) => c - 1);
    } else if (books && selectedBookNumber > 1) {
      const prevBook = books.find((b) => b.bookNumber === selectedBookNumber - 1);
      if (prevBook) {
        setSelectedBookNumber(prevBook.bookNumber);
        setSelectedChapter(prevBook.chapterCount);
      }
    }
  };

  const handleNextChapter = () => {
    if (currentBook && selectedChapter < currentBook.chapterCount) {
      setSelectedChapter((c) => c + 1);
    } else if (books && selectedBookNumber < 66) {
      setSelectedBookNumber((b) => b + 1);
      setSelectedChapter(1);
    }
  };

  const handleStageConfirm = () => {
    if (!selectedStart || !selectedEnd) return;
    onAddSegment(selectedStart, selectedEnd);
    setSelectedStart(null);
    setSelectedEnd(null);
  };

  const filteredBooks = (books ?? []).filter((b) =>
    b.bookName.toLowerCase().includes(bookFilter.trim().toLowerCase())
  );
  const otBooks = filteredBooks.filter((b) => b.testament === 'OLD');
  const ntBooks = filteredBooks.filter((b) => b.testament === 'NEW');
  const chapterCount = currentBook?.chapterCount ?? 50;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-lg">King James Bible Navigator</h2>
        <button
          type="button"
          onClick={() => setShowAutoSelect((v) => !v)}
          disabled={isSlipLocked}
          className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition"
        >
          <BookOpenText className="w-4 h-4" />
          Auto-Select Segments
        </button>
      </div>

      {(isBooksError || isChapterError) && (
        <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-3 py-2 rounded-lg flex items-center gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>
            Failed to load KJV data:{' '}
            {((booksError || chapterError) as Error)?.message || 'Check backend server connection.'}
          </span>
        </div>
      )}

      {/* Book & Chapter Dropdown Bar */}
      <div ref={dropdownContainerRef} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
        <div className="sm:col-span-6 relative">
          <label className="block text-xs text-slate-400 mb-1">Book</label>
          <button
            type="button"
            onClick={() => setOpenMenu((m) => (m === 'BOOK' ? null : 'BOOK'))}
            className="w-full bg-slate-950 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between text-slate-100"
          >
            <span className="truncate">
              {isLoadingBooks ? 'Loading books...' : currentBook?.bookName ?? 'Genesis'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {openMenu === 'BOOK' && (
            <div className="absolute z-30 mt-1 w-full min-w-[260px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
              <div className="p-2 border-b border-slate-800 bg-slate-950">
                <input
                  type="text"
                  autoFocus
                  value={bookFilter}
                  onChange={(e) => setBookFilter(e.target.value)}
                  placeholder="Filter books..."
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="max-h-72 overflow-y-auto p-1.5 space-y-2 text-sm">
                {!books?.length ? (
                  <div className="p-3 text-xs text-slate-400 text-center">
                    No books loaded. Ensure `npm run seed:kjv` has run.
                  </div>
                ) : (
                  <>
                    {otBooks.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Old Testament
                        </div>
                        {otBooks.map((b) => (
                          <button
                            key={b.bookNumber}
                            type="button"
                            disabled={!isBookIncluded(b.bookNumber)}
                            onClick={() => handleBookChange(b.bookNumber)}
                            className={
                              `w-full text-left px-2.5 py-1.5 rounded text-sm transition disabled:bg-slate-800 disabled:text-slate-500 
                              ${ b.bookNumber === selectedBookNumber
                                ? 'bg-amber-500 text-slate-950 font-semibold'
                                : 'text-slate-200 hover:bg-slate-800' 
                            }`}
                          >
                            {b.bookName}
                          </button>
                        ))}
                      </div>
                    )}

                    {ntBooks.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          New Testament
                        </div>
                        {ntBooks.map((b) => (
                          <button
                            key={b.bookNumber}
                            type="button"
                            disabled={!isBookIncluded(b.bookNumber)}
                            onClick={() => handleBookChange(b.bookNumber)}
                            className={
                              `w-full text-left px-2.5 py-1.5 rounded text-sm transition disabled:bg-slate-800 disabled:text-slate-500
                              ${ b.bookNumber === selectedBookNumber
                                ? 'bg-amber-500 text-slate-950 font-semibold'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {b.bookName}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sm:col-span-6 relative">
          <label className="block text-xs text-slate-400 mb-1">Chapter</label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrevChapter}
              disabled={selectedBookNumber === 1 && selectedChapter === 1}
              title="Previous Chapter"
              className="p-2 bg-slate-950 border border-slate-700 hover:bg-slate-800 disabled:opacity-30 rounded-lg"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setOpenMenu((m) => (m === 'CHAPTER' ? null : 'CHAPTER'))}
              className="flex-1 bg-slate-950 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between text-slate-100"
            >
              <span>
                Chapter {selectedChapter} <span className="text-slate-500">/ {chapterCount}</span>
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={handleNextChapter}
              disabled={selectedBookNumber === 66 && selectedChapter === chapterCount}
              title="Next Chapter"
              className="p-2 bg-slate-950 border border-slate-700 hover:bg-slate-800 disabled:opacity-30 rounded-lg"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {openMenu === 'CHAPTER' && (
            <div className="absolute right-0 z-30 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1">
                Select Chapter ({currentBook?.bookName ?? 'Genesis'})
              </div>
              <div className="max-h-64 overflow-y-auto grid grid-cols-5 gap-1.5">
                {Array.from({ length: chapterCount }, (_, i) => i + 1).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => handleChapterChange(ch)}
                    className={`py-1.5 rounded text-xs font-mono transition ${
                      ch === selectedChapter
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Keyword Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Or search KJV keywords (e.g., 'silver and gold', 'giants', 'lilies')..."
          className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            title="Clear search and return to chapter reader"
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Staged Start / End Selection Bar */}
      {(selectedStart || selectedEnd) && (
        <div className="bg-slate-950 border border-amber-500/40 rounded-lg p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="space-y-0.5">
            <div>
              <span className="text-slate-400">Start:</span>{' '}
              <strong className="text-amber-300">
                {selectedStart
                  ? `${selectedStart.bookName} ${selectedStart.chapter}:${selectedStart.verse}`
                  : 'Select a verse'}
              </strong>
              <span className="mx-2 text-slate-600">→</span>
              <span className="text-slate-400">End:</span>{' '}
              <strong className="text-amber-300">
                {selectedEnd
                  ? `${selectedEnd.bookName} ${selectedEnd.chapter}:${selectedEnd.verse}`
                  : 'Select a verse'}
              </strong>
            </div>
            {stagedLength !== null && (
              <div
                className={`text-xs font-mono ${
                  !isStagedLengthValid ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                Span: {stagedLength} verse{stagedLength === 1 ? '' : 's'} (allowed: {minSegmentLength}–{maxSegmentLength})
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedStart(null);
                setSelectedEnd(null);
              }}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleStageConfirm}
              disabled={!selectedStart || !selectedEnd || isSlipLocked || !isStagedLengthValid}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-semibold text-xs px-3 py-1.5 rounded"
            >
              Add to Slip
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <span>
          {isSearching
            ? `Search results for "${searchQuery.trim()}" (${displayedVerses?.length ?? 0} matches)`
            : `${currentBook?.bookName ?? 'Genesis'} — Chapter ${selectedChapter}`}
        </span>
        <span>Tip: Segments can span across chapters or books</span>
      </div>

      {/* Verse Reader List */}
      <div className="max-h-[460px] overflow-y-auto divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-slate-950/60">
        {isLoadingVerses ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading scripture...</div>
        ) : displayedVerses?.length ? (
          displayedVerses.map((v) => {
            const isStart = selectedStart?.verseId === v.verseId;
            const isEnd = selectedEnd?.verseId === v.verseId;
            const isInRange =
              stagedStartId !== null &&
              stagedEndId !== null &&
              v.verseId >= stagedStartId &&
              v.verseId <= stagedEndId;

            return (
              <div
                key={v.verseId}
                className={`p-3 flex items-start justify-between gap-3 transition ${
                  isStart || isEnd
                    ? 'bg-amber-500/15'
                    : isInRange
                    ? 'bg-amber-500/5'
                    : 'hover:bg-slate-900/90'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-400">
                      {isSearching ? `${v.bookName} ${v.chapter}:${v.verse}` : `${v.chapter}:${v.verse}`}
                    </span>
                    {isStart && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-slate-950">
                        Start
                      </span>
                    )}
                    {isEnd && (
                      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-slate-950">
                        End
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 font-serif mt-0.5 leading-relaxed">{v.text}</p>
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedStart(v)}
                    className={`text-xs px-2 py-1 rounded ${
                      isStart
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    Set Start
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedEnd(v)}
                    className={`text-xs px-2 py-1 rounded ${
                      isEnd
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    }`}
                  >
                    Set End
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">No verses found.</div>
        )}
      </div>

      {/* Inline Auto-Select Form */}
      {showAutoSelect && (
        <AutoSelectInlineForm
          maxVerses={maxVerses}
          minSegmentLength={minSegmentLength}
          maxSegmentLength={maxSegmentLength}
          minSegments={minSegments}
          maxSegments={maxSegments}
          isLoading={isAutoSelecting}
          startBook={state?.round.startBook ?? 1}
          endBook={state?.round.endBook ?? 66}
          onGenerate={(req) => {
            onAutoSelect(req);
            setShowAutoSelect(false);
          }}
        />
      )}
    </div>
  );
}


export function KjvExplorerMini({
  startBook,
  endBook,
  onStartBookChange,
  onEndBookChange,
}: KjvExplorerMiniProps) {
  const [_searchQuery, setSearchQuery] = useState<string>('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [pctOfFullText, setPctOfFullText] = useState<number>(25);
  const [pctMargin, setPctMargin] = useState<number>(5);

  // Custom dropdown state
  const [openStartBookMenu, setStartBookOpenMenu] = useState<'BOOK' | null>(null);
  const [openEndBookMenu, setEndBookOpenMenu] = useState<'BOOK' | null>(null);
  const [bookFilter, setBookFilter] = useState<string>('');
  const dropdownContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(e.target as Node)) {
        setStartBookOpenMenu(null);
        setEndBookOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const {
    data: books,
    isLoading: isLoadingBooks,
    isError: _isBooksError,
    error: _booksError,
  } = useQuery<KjvBookMeta[]>({
    queryKey: ['kjvBooks'],
    queryFn: () => apiFetch<KjvBookMeta[]>('/kjv/books'),
    staleTime: Infinity,
  });

  const currentStartBook = books?.find((b) => b.bookNumber === startBook);
  const currentEndBook = books?.find((b) => b.bookNumber === endBook);
  // const isSearching = searchQuery.trim().length >= 3;

  const handleStartBookChange = (newBookNum: number) => {
    onStartBookChange(newBookNum);
    setSearchQuery('');
    setBookFilter('');
    setStartBookOpenMenu(null);
  };

  const handleEndBookChange = (newBookNum: number) => {
    onEndBookChange(newBookNum);
    setSearchQuery('');
    setBookFilter('');
    setEndBookOpenMenu(null);
  };


  const filteredBooks = (books ?? []).filter((b) =>
    b.bookName.toLowerCase().includes(bookFilter.trim().toLowerCase())
  );
  const otBooks = filteredBooks.filter((b) => b.testament === 'OLD');
  const ntBooks = filteredBooks.filter((b) => b.testament === 'NEW');

  const randSectionMutation = useMutation({
    mutationFn: () =>
      apiFetch<KjvSection>('/kjv/random-section', {
        method: 'POST',
        body: JSON.stringify({
          fullTextPct: pctOfFullText,
          marginPct: pctMargin
        }),
      }),
    onSuccess: (sectionResp) => {
      handleStartBookChange(sectionResp.startBook);
      handleEndBookChange(sectionResp.endBook);
      setFeedbackError(null);
    },
    onError: (err: ApiError) => setFeedbackError(err.message),
  });

  return (
    
    <div className="bg-slate-900  rounded-xl p-4 space-y-4">
      <h3 className="font-semibold text-lg">Select Book Range</h3>

      {/* Auto select random books to hit percentage  */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        
        <div>
          <label className="block text-xs text-slate-400 mb-1">Percentage of full text to use</label>
          
          <div className="relative">
            <input
              type="number"
              min={0}
              value={pctOfFullText}
              onChange={(e) => setPctOfFullText(Number(e.target.value))}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-12 font-mono"
            />
            <span className="text-[11px] text-slate-500 absolute right-2.5 top-2.5">%</span>
            
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Allowable margin</label>
          <div className="relative">
            <input
              type="number"
              min={0}
              value={pctMargin}
              onChange={(e) => setPctMargin(Number(e.target.value))}
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 pr-12 font-mono"
            />
            <span className="text-[11px] text-slate-500 absolute right-2.5 top-2.5">%</span>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">Run</label>
          <button
            type="button"
            onClick={() => randSectionMutation.mutate() }
            disabled={false}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg"
          >
            {false ? 'Selecting Ranges...' : 'Select a Random Range'}
          </button>
        </div>

        {feedbackError && (
          <div className="bg-rose-950/60 border border-rose-800 text-rose-200 px-4 py-3 rounded-lg flex items-center gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            {feedbackError}
          </div>
        )}

      </div>

      {/* Book & Chapter Dropdown Bar */}
      <div ref={dropdownContainerRef} className="grid grid-cols-2 sm:grid-cols-12 gap-2.5">

        {/* Start Book selection */}
        <div className="sm:col-span-6 relative">
          <label className="block text-xs text-slate-400 mb-1">Start Book</label>
          <button
            type="button"
            onClick={() => setStartBookOpenMenu((m) => (m === 'BOOK' ? null : 'BOOK'))}
            className="w-full bg-slate-950 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between text-slate-100"
          >
            <span className="truncate">
              {isLoadingBooks ? 'Loading books...' : currentStartBook?.bookName ?? 'Genesis'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {openStartBookMenu === 'BOOK' && (
            <div className="absolute z-30 mt-1 w-full min-w-[260px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
              <div className="p-2 border-b border-slate-800 bg-slate-950">
                <input
                  type="text"
                  autoFocus
                  value={bookFilter}
                  onChange={(e) => setBookFilter(e.target.value)}
                  placeholder="Filter books..."
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="max-h-72 overflow-y-auto p-1.5 space-y-2 text-sm">
                {!books?.length ? (
                  <div className="p-3 text-xs text-slate-400 text-center">
                    No books loaded. Ensure `npm run seed:kjv` has run.
                  </div>
                ) : (
                  <>
                    {otBooks.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Old Testament
                        </div>
                        {otBooks.map((b) => (
                          <button
                            key={b.bookNumber}
                            type="button"
                            onClick={() => handleStartBookChange(b.bookNumber)}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition ${
                              b.bookNumber === startBook
                                ? 'bg-amber-500 text-slate-950 font-semibold'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {b.bookName}
                          </button>
                        ))}
                      </div>
                    )}

                    {ntBooks.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          New Testament
                        </div>
                        {ntBooks.map((b) => (
                          <button
                            key={b.bookNumber}
                            type="button"
                            onClick={() => handleStartBookChange(b.bookNumber)}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition ${
                              b.bookNumber === startBook
                                ? 'bg-amber-500 text-slate-950 font-semibold'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {b.bookName}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* End Book selection */}
        <div className="sm:col-span-6 relative">
          <label className="block text-xs text-slate-400 mb-1">End Book</label>
          <button
            type="button"
            onClick={() => setEndBookOpenMenu((m) => (m === 'BOOK' ? null : 'BOOK'))}
            className="w-full bg-slate-950 border border-slate-700 hover:border-slate-500 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between text-slate-100"
          >
            <span className="truncate">
              {isLoadingBooks ? 'Loading books...' : currentEndBook?.bookName ?? 'Genesis'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {openEndBookMenu === 'BOOK' && (
            <div className="absolute z-30 mt-1 w-full min-w-[260px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
              <div className="p-2 border-b border-slate-800 bg-slate-950">
                <input
                  type="text"
                  autoFocus
                  value={bookFilter}
                  onChange={(e) => setBookFilter(e.target.value)}
                  placeholder="Filter books..."
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="max-h-72 overflow-y-auto p-1.5 space-y-2 text-sm">
                {!books?.length ? (
                  <div className="p-3 text-xs text-slate-400 text-center">
                    No books loaded. Ensure `npm run seed:kjv` has run.
                  </div>
                ) : (
                  <>
                    {otBooks.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Old Testament
                        </div>
                        {otBooks.map((b) => (
                          <button
                            key={b.bookNumber}
                            type="button"
                            onClick={() => handleEndBookChange(b.bookNumber)}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition ${
                              b.bookNumber === endBook
                                ? 'bg-amber-500 text-slate-950 font-semibold'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {b.bookName}
                          </button>
                        ))}
                      </div>
                    )}

                    {ntBooks.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          New Testament
                        </div>
                        {ntBooks.map((b) => (
                          <button
                            key={b.bookNumber}
                            type="button"
                            onClick={() => handleEndBookChange(b.bookNumber)}
                            className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition ${
                              b.bookNumber === endBook
                                ? 'bg-amber-500 text-slate-950 font-semibold'
                                : 'text-slate-200 hover:bg-slate-800'
                            }`}
                          >
                            {b.bookName}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    
  );
}


function AutoSelectInlineForm({
  maxVerses,
  minSegmentLength,
  maxSegmentLength,
  minSegments,
  maxSegments,
  isLoading,
  startBook,
  endBook,
  onGenerate,
}: {
  maxVerses: number;
  minSegmentLength: number;
  maxSegmentLength: number;
  minSegments: number;
  maxSegments: number;
  isLoading: boolean;
  startBook: number;
  endBook: number;
  onGenerate: (req: AutoSelectRequest) => void;
}) {
  const [testament, setTestament] = useState<'ALL' | 'OLD' | 'NEW'>('ALL');
  const [segmentCount, setSegmentCount] = useState(
    Math.max(minSegments, Math.min(maxSegments, 3))
  );
  const [totalLength, setTotalLength] = useState(
    Math.max(minSegments * minSegmentLength, Math.min(30, maxVerses))
  );

  const minAllowedTotal = segmentCount * minSegmentLength;
  const maxAllowedTotal = Math.min(segmentCount * maxSegmentLength, maxVerses);

  const {
    data: startBookMeta
  } = useQuery<KjvBookMeta>({
    queryKey: ['kjvBook', startBook],
    queryFn: () =>
      apiFetch<KjvBookMeta>(`/kjv/books/${startBook}`),
    staleTime: Infinity,
  });
  
  const {
    data: endBookMeta
  } = useQuery<KjvBookMeta>({
    queryKey: ['kjvBook', endBook],
    queryFn: () =>
      apiFetch<KjvBookMeta>(`/kjv/books/${endBook}`),
    staleTime: Infinity,
  });
  
  const startVerseId = startBookMeta?.startVerseId;
  const endVerseId = endBookMeta?.endVerseId;

  return (
    <div className="bg-slate-950 border border-indigo-500/40 rounded-lg p-4 space-y-3 text-sm">
      <h3 className="font-semibold text-indigo-300">Auto-Select Configuration</h3>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Testament Pool</label>
          <select
            value={testament}
            onChange={(e) => setTestament(e.target.value as 'ALL' | 'OLD' | 'NEW')}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5"
          >
            <option value="ALL">Round Range</option>
            <option value="OLD">Old Testament</option>
            <option value="NEW">New Testament</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Segments ({minSegments}–{maxSegments})
          </label>
          <input
            type="number"
            min={minSegments}
            max={maxSegments}
            value={segmentCount}
            onChange={(e) => {
              const nextCount = Number(e.target.value);
              setSegmentCount(nextCount);
              setTotalLength((prev) =>
                Math.max(nextCount * minSegmentLength, Math.min(prev, Math.min(nextCount * maxSegmentLength, maxVerses)))
              );
            }}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Total Verses ({minAllowedTotal}–{maxAllowedTotal})
          </label>
          <input
            type="number"
            min={minAllowedTotal}
            max={maxAllowedTotal}
            value={totalLength}
            onChange={(e) => setTotalLength(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          onGenerate({
            testament: testament === 'ALL' ? undefined : testament,
            customRange: [startVerseId ?? 1, endVerseId ?? 31102],
            segmentCount,
            totalLength,
          })
        }
        disabled={isLoading || totalLength < minAllowedTotal || totalLength > maxAllowedTotal}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold py-2 rounded-lg"
      >
        {isLoading ? 'Generating Ranges...' : 'Generate Random Non-Overlapping Segments'}
      </button>
    </div>
  );
}