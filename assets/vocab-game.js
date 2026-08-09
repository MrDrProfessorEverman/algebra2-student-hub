// Vocabulary Game engine - shared, track-agnostic. Driven entirely by the globals
// VOCAB_TRACK (string) and VOCAB_UNITS (array of {unit, title, terms:[{term,def}]})
// that vocab-data.js defines before this file loads. Hand-maintained static asset,
// like site.js/style.css - not generated per build.
//
// Flow: game picker -> unit multi-select -> play. The first two screens are static
// markup from Build-VocabGame (tools/lib-hub.ps1); everything past "Start Game" is
// built here, since gameplay is inherently interactive.
//
// Symbols/emoji are written as HTML numeric entities inside innerHTML strings rather
// than literal Unicode in this file's source - matches how every generated page in
// this repo already handles non-ASCII (see tools/README.md's token system) and
// sidesteps any source-encoding ambiguity for a plain static .js asset.

(function () {
  'use strict';

  var UNITS = (typeof VOCAB_UNITS !== 'undefined') ? VOCAB_UNITS : [];
  var TRACK = (typeof VOCAB_TRACK !== 'undefined') ? VOCAB_TRACK : 'on-level';

  var screenGames = document.getElementById('vocab-screen-games');
  var screenUnits = document.getElementById('vocab-screen-units');
  var screenPlay = document.getElementById('vocab-screen-play');
  var playNav = document.getElementById('vocabPlayNav');
  var playArea = document.getElementById('vocabPlayArea');
  var noneWarning = document.getElementById('vocabNoneWarning');

  if (!screenGames || !screenUnits || !screenPlay) { return; } // vocab.html not loaded

  var selectedGame = null;
  var currentCleanup = null; // active game's own teardown (clears intervals, etc.)

  // Every game schedules short setTimeouts (auto-advance delays, mismatch flip-back,
  // Blitz respawns). Without tracking them, navigating away mid-delay lets a stale
  // callback fire later and write into #vocabPlayArea even though the player left -
  // harmless-looking (the play screen is hidden) until the player starts a NEW game
  // and that stale callback clobbers the fresh instance's DOM. trackTimeout/
  // clearAllTimeouts centralize the fix so every game gets it for free.
  var activeTimeouts = [];
  function trackTimeout(fn, ms) {
    var id = setTimeout(fn, ms);
    activeTimeouts.push(id);
    return id;
  }
  function clearAllTimeouts() {
    activeTimeouts.forEach(function (id) { clearTimeout(id); });
    activeTimeouts = [];
  }

  function showScreen(el) {
    [screenGames, screenUnits, screenPlay].forEach(function (s) { s.hidden = (s !== el); });
  }

  function teardownCurrentGame() {
    clearAllTimeouts();
    if (typeof currentCleanup === 'function') { currentCleanup(); }
    currentCleanup = null;
  }

  // ---------------- localStorage progress (flashcards only) ----------------
  // Purely local to the student's own device - nothing is sent anywhere. See
  // hub/README.md's Content Rules: no analytics, nothing collected about a
  // specific student. Falls back to an in-memory object if storage is blocked.
  var memStore = {};
  function storeKey(term) { return 'vocab:' + TRACK + ':' + term.toLowerCase(); }
  function getKnown(term) {
    try { return window.localStorage.getItem(storeKey(term)); }
    catch (e) { return memStore[storeKey(term)] || null; }
  }
  function setKnown(term, value) {
    try { window.localStorage.setItem(storeKey(term), value); }
    catch (e) { memStore[storeKey(term)] = value; }
  }

  // ---------------- helpers ----------------
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pool(unitNums) {
    var seen = {};
    var out = [];
    UNITS.forEach(function (u) {
      if (unitNums.indexOf(u.unit) === -1) { return; }
      u.terms.forEach(function (t) {
        var k = t.term.toLowerCase();
        if (seen[k]) { return; }
        seen[k] = true;
        out.push(t);
      });
    });
    return out;
  }

  function renderPlayNav(onBack) {
    playNav.innerHTML =
      '<button type="button" class="back-link vocab-back" id="vocabBackToMenu">&larr; Back to Vocab Menu</button>';
    document.getElementById('vocabBackToMenu').addEventListener('click', function () {
      teardownCurrentGame();
      showScreen(screenGames);
    });
  }

  function summaryHtml(title, statsHtml) {
    return (
      '<div class="vocab-summary">' +
      '<h2 class="section-title" style="margin-top:0;">' + title + '</h2>' +
      '<p class="lede">' + statsHtml + '</p>' +
      '<div class="vocab-summary-btns">' +
      '<button type="button" class="btn" id="vocabPlayAgain">Play Again</button>' +
      '<button type="button" class="btn btn-secondary" id="vocabBackToMenu2">Back to Menu</button>' +
      '</div></div>'
    );
  }
  function wireSummaryButtons(replay) {
    var again = document.getElementById('vocabPlayAgain');
    var back = document.getElementById('vocabBackToMenu2');
    // Same teardown as "Back to Vocab Menu" - without it, a still-armed timer
    // from the round that just ended (Blitz's missTimer, Matching's setInterval)
    // can fire later and stomp on the freshly-restarted game's DOM.
    if (again) {
      again.addEventListener('click', function () {
        teardownCurrentGame();
        replay();
      });
    }
    if (back) {
      back.addEventListener('click', function () {
        teardownCurrentGame();
        showScreen(screenGames);
      });
    }
  }

  // ================= 1. FLASHCARDS =================
  function playFlashcards(terms) {
    var deck = shuffle(terms).sort(function (a, b) {
      // previously-missed terms surface first; previously-known last
      var rank = function (t) { var k = getKnown(t.term); return k === 'unknown' ? 0 : (k === 'known' ? 2 : 1); };
      return rank(a) - rank(b);
    });
    var mastered = 0;
    var total = deck.length;
    var flipped = false;

    function render() {
      if (deck.length === 0) {
        playArea.innerHTML = summaryHtml(
          'All ' + total + ' terms done! &#127881;',
          'You marked every card Got It at least once. Missed ones show up first next round.'
        );
        wireSummaryButtons(function () { playFlashcards(terms); });
        return;
      }
      var card = deck[0];
      flipped = false;
      playArea.innerHTML =
        '<div class="fc-progress">Card ' + (total - deck.length + 1) + ' of ' + total + ' &bull; ' + mastered + ' mastered this round</div>' +
        '<div class="fc-wrap"><div class="fc-card" id="fcCard"><div class="fc-card-inner" id="fcCardInner">' +
        '<div class="fc-face fc-face-front">' + esc(card.term) + '</div>' +
        '<div class="fc-face fc-face-back">' + esc(card.def) + '</div>' +
        '</div></div></div>' +
        '<p class="fc-hint" id="fcHint">Tap the card to flip it</p>' +
        '<div class="fc-controls" id="fcControls" hidden>' +
        '<button type="button" class="fc-btn fc-btn-study" id="fcStudy">&#10060; Study More</button>' +
        '<button type="button" class="fc-btn fc-btn-know" id="fcKnow">&#9989; Got It</button>' +
        '</div>';

      var cardEl = document.getElementById('fcCard');
      cardEl.addEventListener('click', function () {
        flipped = !flipped;
        document.getElementById('fcCardInner').classList.toggle('flipped', flipped);
        document.getElementById('fcControls').hidden = !flipped;
        document.getElementById('fcHint').hidden = flipped;
      });
      document.getElementById('fcKnow').addEventListener('click', function (ev) {
        ev.stopPropagation();
        setKnown(card.term, 'known');
        mastered++;
        deck.shift();
        render();
      });
      document.getElementById('fcStudy').addEventListener('click', function (ev) {
        ev.stopPropagation();
        setKnown(card.term, 'unknown');
        deck.push(deck.shift());
        render();
      });
    }

    renderPlayNav();
    render();
    currentCleanup = function () {};
  }

  // ================= 2. MATCHING =================
  function playMatching(terms) {
    var pairCount = Math.min(8, terms.length);
    var chosen = shuffle(terms).slice(0, pairCount);
    var tiles = [];
    chosen.forEach(function (t, i) {
      tiles.push({ id: i, kind: 'term', text: t.term });
      tiles.push({ id: i, kind: 'def', text: t.def });
    });
    tiles = shuffle(tiles);

    var flippedIdx = [];
    var matchedIds = {};
    var moves = 0;
    var seconds = 0;
    var timer = setInterval(function () { seconds++; updateMeta(); }, 1000);
    var busy = false;

    function updateMeta() {
      var meta = document.getElementById('matchMeta');
      if (meta) { meta.textContent = 'Moves: ' + moves + ' · Time: ' + seconds + 's'; }
    }

    function render() {
      var html = '<div class="match-meta" id="matchMeta">Moves: ' + moves + ' · Time: ' + seconds + 's</div><div class="match-grid">';
      tiles.forEach(function (tile, idx) {
        var isMatched = matchedIds[tile.id];
        var isFlipped = flippedIdx.indexOf(idx) !== -1;
        var cls = 'match-tile' + (isMatched ? ' matched' : '') + (isFlipped || isMatched ? ' flipped' : '');
        html += '<button type="button" class="' + cls + '" data-idx="' + idx + '"' + (isMatched ? ' disabled' : '') + '>' +
          ((isFlipped || isMatched) ? '<span class="match-tile-text">' + esc(tile.text) + '</span>' : '<span class="match-tile-back">?</span>') +
          '</button>';
      });
      html += '</div>';
      playArea.innerHTML = html;

      Array.prototype.forEach.call(playArea.querySelectorAll('.match-tile'), function (btn) {
        btn.addEventListener('click', function () { onTileClick(parseInt(btn.getAttribute('data-idx'), 10)); });
      });

      if (Object.keys(matchedIds).length === chosen.length) {
        clearInterval(timer);
        playArea.innerHTML += summaryHtml(
          'Matched them all! &#127881;',
          'Solved in ' + moves + ' moves, ' + seconds + ' seconds.'
        );
        wireSummaryButtons(function () { playMatching(terms); });
      }
    }

    function onTileClick(idx) {
      if (busy) { return; }
      if (flippedIdx.indexOf(idx) !== -1) { return; }
      if (matchedIds[tiles[idx].id]) { return; }
      flippedIdx.push(idx);
      render();
      if (flippedIdx.length === 2) {
        moves++;
        var a = tiles[flippedIdx[0]], b = tiles[flippedIdx[1]];
        if (a.id === b.id && a.kind !== b.kind) {
          matchedIds[a.id] = true;
          flippedIdx = [];
          render();
        } else {
          busy = true;
          trackTimeout(function () { flippedIdx = []; busy = false; render(); }, 800);
        }
      }
    }

    renderPlayNav();
    render();
    currentCleanup = function () { clearInterval(timer); };
  }

  // ================= 3. QUICK QUIZ =================
  function playQuiz(terms) {
    var rounds = Math.min(10, Math.max(4, terms.length));
    var asked = 0;
    var score = 0;
    var streak = 0;
    var bestStreak = 0;
    var locked = false;

    function nextQuestion() {
      if (asked >= rounds) {
        playArea.innerHTML = summaryHtml(
          'Quiz done! &#127942;',
          'Score: ' + score + ' / ' + rounds + ' · Best streak: ' + bestStreak
        );
        wireSummaryButtons(function () { playQuiz(terms); });
        return;
      }
      locked = false;
      var q = terms[Math.floor(Math.random() * terms.length)];
      var choiceCount = Math.min(4, terms.length);
      var distractors = shuffle(terms.filter(function (t) { return t.term !== q.term; })).slice(0, choiceCount - 1);
      var choices = shuffle(distractors.concat([q]));

      var html = '<div class="quiz-meta">Question ' + (asked + 1) + ' of ' + rounds + ' · Score ' + score + ' · Streak ' + streak + '</div>' +
        '<div class="quiz-term">' + esc(q.term) + '</div><div class="quiz-choices">';
      choices.forEach(function (c, i) {
        html += '<button type="button" class="quiz-choice" data-correct="' + (c.term === q.term ? '1' : '0') + '">' + esc(c.def) + '</button>';
      });
      html += '</div>';
      playArea.innerHTML = html;

      Array.prototype.forEach.call(playArea.querySelectorAll('.quiz-choice'), function (btn) {
        btn.addEventListener('click', function () {
          if (locked) { return; }
          locked = true;
          var correct = btn.getAttribute('data-correct') === '1';
          Array.prototype.forEach.call(playArea.querySelectorAll('.quiz-choice'), function (b) {
            if (b.getAttribute('data-correct') === '1') { b.classList.add('correct'); }
          });
          if (!correct) { btn.classList.add('wrong'); }
          if (correct) { score++; streak++; bestStreak = Math.max(bestStreak, streak); } else { streak = 0; }
          asked++;
          trackTimeout(nextQuestion, 900);
        });
      });
    }

    renderPlayNav();
    nextQuestion();
    currentCleanup = function () {};
  }

  // ================= 4. TERM TYPER =================
  function normalize(s) {
    return String(s).toLowerCase().trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  }
  function playTyper(terms) {
    var rounds = Math.min(10, Math.max(4, terms.length));
    var asked = 0;
    var score = 0;
    var attempts = 0;
    var current = null;

    function nextQuestion() {
      if (asked >= rounds) {
        playArea.innerHTML = summaryHtml(
          'Typing round done! &#9000;',
          'Score: ' + score + ' / ' + rounds
        );
        wireSummaryButtons(function () { playTyper(terms); });
        return;
      }
      attempts = 0;
      current = terms[Math.floor(Math.random() * terms.length)];
      renderQuestion('');
    }

    function renderQuestion(hint) {
      playArea.innerHTML =
        '<div class="typer-meta">Question ' + (asked + 1) + ' of ' + rounds + ' · Score ' + score + '</div>' +
        '<div class="typer-def">' + esc(current.def) + '</div>' +
        '<div class="typer-input-row">' +
        '<input type="text" id="typerInput" class="typer-input" autocomplete="off" placeholder="Type the term...">' +
        '<button type="button" class="btn" id="typerSubmit">Check</button>' +
        '</div>' +
        '<p class="typer-hint" id="typerHint">' + hint + '</p>';

      var input = document.getElementById('typerInput');
      input.focus();
      function submit() {
        var val = normalize(input.value);
        if (!val) { return; }
        if (val === normalize(current.term)) {
          score++;
          asked++;
          playArea.innerHTML = '<div class="typer-correct">&#9989; ' + esc(current.term) + '</div>';
          trackTimeout(nextQuestion, 700);
          return;
        }
        attempts++;
        if (attempts === 1) {
          var blanks = current.term.replace(/[^\s-]/g, '_ ').trim();
          renderQuestion('Not quite. Length hint: ' + esc(blanks));
        } else if (attempts === 2) {
          renderQuestion('First letter: ' + esc(current.term.charAt(0).toUpperCase()) + ' &hellip;');
        } else {
          asked++;
          playArea.innerHTML = '<div class="typer-missed">The answer was: <strong>' + esc(current.term) + '</strong></div>';
          trackTimeout(nextQuestion, 1200);
        }
      }
      document.getElementById('typerSubmit').addEventListener('click', submit);
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { submit(); } });
    }

    renderPlayNav();
    nextQuestion();
    currentCleanup = function () {};
  }

  // ================= 5. VOCAB BLITZ (arcade) =================
  // A fixed 10-round sequence (not endless) so pacing can be scripted by round
  // number: rounds 1-3 slow, 4-7 medium, 8-10 fast, with a banner announcing
  // each speed change. Scoring: 2 points for catching a term on the first try,
  // 1 point if it took extra wrong guesses first. 3 lives total; running out
  // ends the game early, otherwise it ends naturally after round 10.
  var BLITZ_ZONES = [
    { maxRound: 3, name: 'Slow Zone', fallMs: 6000 },
    { maxRound: 7, name: 'Medium Zone', fallMs: 3500 },
    { maxRound: 10, name: 'Fast Zone', fallMs: 2300 }
  ];
  function blitzZoneFor(round) {
    for (var i = 0; i < BLITZ_ZONES.length; i++) { if (round <= BLITZ_ZONES[i].maxRound) { return BLITZ_ZONES[i]; } }
    return BLITZ_ZONES[BLITZ_ZONES.length - 1];
  }

  function playBlitz(terms) {
    var TOTAL_ROUNDS = 10;
    var round = 0; // count of rounds started so far
    var lives = 3;
    var score = 0;
    var active = null; // {term, missTimer, wrongAttempts}
    var over = false;
    var zoneName = null;

    function render() {
      playArea.innerHTML =
        '<div class="blitz-meta"><span class="blitz-lives" id="blitzLives"></span>' +
        '<span class="blitz-round" id="blitzRound"></span>' +
        '<span class="blitz-score" id="blitzScore">Score: ' + score + '</span></div>' +
        '<div class="blitz-sky" id="blitzSky"></div>' +
        '<div class="blitz-buckets" id="blitzBuckets"></div>';
      renderLives();
      renderRound();
    }
    function renderLives() {
      var el = document.getElementById('blitzLives');
      if (el) { el.innerHTML = Array(Math.max(0, lives)).fill('&#10084;&#65039; ').join(''); }
    }
    function renderRound() {
      var el = document.getElementById('blitzRound');
      if (el) { el.textContent = 'Round ' + Math.min(round, TOTAL_ROUNDS) + ' of ' + TOTAL_ROUNDS; }
    }
    function renderScore() {
      var el = document.getElementById('blitzScore');
      if (el) { el.textContent = 'Score: ' + score; }
    }

    function startRound() {
      if (over) { return; }
      round++;
      if (round > TOTAL_ROUNDS) { finishRound(); return; }
      renderRound();
      var zone = blitzZoneFor(round);
      if (zoneName !== null && zone.name !== zoneName) {
        zoneName = zone.name;
        showZoneBanner(zone, function () { spawn(zone.fallMs); });
      } else {
        zoneName = zone.name;
        spawn(zone.fallMs);
      }
    }

    function showZoneBanner(zone, next) {
      var sky = document.getElementById('blitzSky');
      var buckets = document.getElementById('blitzBuckets');
      if (sky) { sky.innerHTML = '<div class="blitz-zone-banner">&#9889; New zone: ' + esc(zone.name) + '!</div>'; }
      if (buckets) { buckets.innerHTML = ''; }
      trackTimeout(next, 1300);
    }

    function spawn(fallMs) {
      if (over) { return; }
      var q = terms[Math.floor(Math.random() * terms.length)];
      var choiceCount = Math.min(4, terms.length);
      var distractors = shuffle(terms.filter(function (t) { return t.term !== q.term; })).slice(0, choiceCount - 1);
      var choices = shuffle(distractors.concat([q]));

      var sky = document.getElementById('blitzSky');
      var buckets = document.getElementById('blitzBuckets');
      if (!sky || !buckets) { return; }
      sky.innerHTML = '<div class="blitz-falling" id="blitzFalling">' + esc(q.term) + '</div>';
      buckets.innerHTML = '';
      choices.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'blitz-bucket';
        b.textContent = c.def;
        b.addEventListener('click', function () { catchAttempt(c.term === q.term, b); });
        buckets.appendChild(b);
      });

      var fEl = document.getElementById('blitzFalling');
      fEl.style.transition = 'top ' + fallMs + 'ms linear';
      // next frame so the transition actually animates from 0
      requestAnimationFrame(function () { requestAnimationFrame(function () { fEl.style.top = '100%'; }); });

      var missTimer = trackTimeout(function () { missed(); }, fallMs);
      active = { term: q.term, missTimer: missTimer, wrongAttempts: 0 };
    }

    function catchAttempt(correct, btnEl) {
      if (!active || over) { return; }
      if (correct) {
        clearTimeout(active.missTimer);
        var points = active.wrongAttempts === 0 ? 2 : 1;
        score += points;
        renderScore();
        active = null;
        var sky = document.getElementById('blitzSky');
        if (sky) { sky.innerHTML = '<div class="blitz-falling blitz-caught">&#9989; +' + points + '</div>'; }
        var buckets = document.getElementById('blitzBuckets');
        if (buckets) { buckets.innerHTML = ''; }
        trackTimeout(startRound, 450);
      } else {
        active.wrongAttempts++;
        btnEl.classList.add('wrong-flash');
        trackTimeout(function () { btnEl.classList.remove('wrong-flash'); }, 300);
      }
    }

    function missed() {
      lives--;
      renderLives();
      active = null;
      if (lives <= 0) {
        gameOver();
      } else {
        trackTimeout(startRound, 400);
      }
    }

    function finishRound() {
      over = true;
      playArea.innerHTML = summaryHtml(
        'Blitz complete! &#127881;',
        'Score: ' + score + ' out of ' + (TOTAL_ROUNDS * 2) + ' possible.'
      );
      wireSummaryButtons(function () { playBlitz(terms); });
    }

    function gameOver() {
      over = true;
      playArea.innerHTML = summaryHtml(
        'Game Over &#128377;',
        'Final score: ' + score + ' (made it to round ' + Math.min(round, TOTAL_ROUNDS) + ' of ' + TOTAL_ROUNDS + ')'
      );
      wireSummaryButtons(function () { playBlitz(terms); });
    }

    renderPlayNav();
    render();
    startRound();
    currentCleanup = function () {
      over = true;
      if (active && active.missTimer) { clearTimeout(active.missTimer); }
    };
  }

  var GAMES = {
    flashcards: playFlashcards,
    matching: playMatching,
    quiz: playQuiz,
    typer: playTyper,
    blitz: playBlitz
  };

  // ---------------- wiring: screen 1 (games) ----------------
  Array.prototype.forEach.call(document.querySelectorAll('.game-card'), function (btn) {
    btn.addEventListener('click', function () {
      selectedGame = btn.getAttribute('data-game');
      showScreen(screenUnits);
    });
  });

  // ---------------- wiring: screen 2 (units) ----------------
  Array.prototype.forEach.call(document.querySelectorAll('.vocab-back[data-back="games"]'), function (btn) {
    btn.addEventListener('click', function () { showScreen(screenGames); });
  });

  var selectAll = document.getElementById('vocabSelectAll');
  if (selectAll) {
    selectAll.addEventListener('change', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.unit-check'), function (cb) { cb.checked = selectAll.checked; });
    });
  }

  var startBtn = document.getElementById('vocabStartBtn');
  if (startBtn) {
    startBtn.addEventListener('click', function () {
      var checked = Array.prototype.filter.call(document.querySelectorAll('.unit-check'), function (cb) { return cb.checked; })
        .map(function (cb) { return parseInt(cb.value, 10); });
      if (checked.length === 0) {
        if (noneWarning) { noneWarning.hidden = false; }
        return;
      }
      if (noneWarning) { noneWarning.hidden = true; }
      var terms = pool(checked);
      if (!selectedGame || !GAMES[selectedGame] || terms.length === 0) { return; }
      teardownCurrentGame();
      showScreen(screenPlay);
      GAMES[selectedGame](terms);
    });
  }
})();
