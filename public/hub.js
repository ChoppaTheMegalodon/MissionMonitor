(function () {
  'use strict';

  // ==========================================================================
  // Top-level tab switching
  // ==========================================================================

  var tabs = document.querySelectorAll('.hub-tab');
  var sections = document.querySelectorAll('.hub-section');
  var engagementLoaded = false;

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');

      var target = tab.dataset.tab;
      sections.forEach(function (s) { s.classList.remove('active'); });
      document.getElementById('tab-' + target).classList.add('active');

      // Lazy-load engagement data on first visit
      if (target === 'engagement' && !engagementLoaded) {
        engagementLoaded = true;
        engLoadMissions();
        engLoadStatus();
      }
    });
  });

  // ==========================================================================
  //  PAYOUTS MODULE
  // ==========================================================================

  var missionsData = [];
  var payoutLog = {};

  function fetchMissions() {
    fetch('/api/missions?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        missionsData = data;
        renderPayouts();
      })
      .catch(function (err) {
        console.error('Failed to fetch missions:', err);
        document.getElementById('missions-container').innerHTML =
          '<div class="empty-state">Failed to load missions</div>';
      });
  }

  function renderPayouts() {
    var container = document.getElementById('missions-container');
    var filter = document.getElementById('filter-status').value;

    var filtered = missionsData.filter(function (m) {
      return filter === 'all' || m.status === filter;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">No missions match this filter</div>';
      return;
    }

    container.innerHTML = '';

    filtered.forEach(function (mission) {
      var block = document.createElement('div');
      block.className = 'mission-block';

      var header = document.createElement('div');
      header.className = 'mission-header';

      var left = document.createElement('div');
      var title = document.createElement('span');
      title.className = 'mission-title';
      title.textContent = mission.title;
      var meta = document.createElement('span');
      meta.className = 'mission-meta';
      var deadline = new Date(mission.deadline).toLocaleDateString();
      meta.textContent = '  Deadline: ' + deadline + ' | ' + mission.submissions.length + ' submissions';
      left.appendChild(title);
      left.appendChild(meta);

      var statusBadge = document.createElement('span');
      statusBadge.className = 'mission-status ' + mission.status;
      statusBadge.textContent = mission.status;

      header.appendChild(left);
      header.appendChild(statusBadge);
      block.appendChild(header);

      if (mission.submissions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No submissions';
        block.appendChild(empty);
      } else {
        var table = document.createElement('table');
        table.className = 'pay-table';
        var thead = document.createElement('thead');
        thead.innerHTML =
          '<tr><th>#</th><th>User</th><th>Source</th><th>Score</th><th>URL</th><th>Wallet</th><th>Referred</th><th>Payout</th></tr>';
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        mission.submissions.forEach(function (sub, idx) {
          var tr = document.createElement('tr');
          tr.setAttribute('data-sub-id', sub.id);

          var tdRank = document.createElement('td');
          tdRank.textContent = (idx + 1).toString();
          tr.appendChild(tdRank);

          var tdUser = document.createElement('td');
          tdUser.textContent = sub.userTag;
          tr.appendChild(tdUser);

          var tdSource = document.createElement('td');
          tdSource.textContent = sub.source;
          tr.appendChild(tdSource);

          var tdScore = document.createElement('td');
          var scoreInput = document.createElement('input');
          scoreInput.type = 'number';
          scoreInput.className = 'score-input';
          scoreInput.min = '0';
          scoreInput.max = '10';
          scoreInput.step = '0.5';
          scoreInput.value = sub.avgScore !== null ? sub.avgScore.toFixed(1) : '';
          scoreInput.placeholder = '-';
          scoreInput.title = sub.voteCount + ' vote(s)';
          scoreInput.id = 'input-score-' + sub.id;

          var savedIndicator = document.createElement('span');
          savedIndicator.className = 'score-saved';
          savedIndicator.textContent = ' saved';

          scoreInput.addEventListener('change', function () {
            saveScore(sub.id, parseFloat(scoreInput.value), savedIndicator);
          });

          tdScore.appendChild(scoreInput);
          tdScore.appendChild(savedIndicator);
          tr.appendChild(tdScore);

          var tdUrl = document.createElement('td');
          if (sub.urls && sub.urls[0]) {
            var link = document.createElement('a');
            link.className = 'url-link';
            link.href = sub.urls[0];
            link.target = '_blank';
            link.textContent = sub.urls[0].replace(/^https?:\/\//, '').slice(0, 40);
            tdUrl.appendChild(link);
          }
          tr.appendChild(tdUrl);

          var tdWallet = document.createElement('td');
          if (sub.wallet) {
            var walletSpan = document.createElement('span');
            walletSpan.className = 'wallet-addr';
            walletSpan.textContent = sub.wallet.slice(0, 6) + '...' + sub.wallet.slice(-4);
            walletSpan.title = sub.wallet;
            tdWallet.appendChild(walletSpan);
          } else {
            var noWallet = document.createElement('span');
            noWallet.className = 'no-wallet';
            noWallet.textContent = 'No wallet';
            tdWallet.appendChild(noWallet);
          }
          tr.appendChild(tdWallet);

          var tdRef = document.createElement('td');
          if (sub.referred) {
            var badge = document.createElement('span');
            badge.className = 'referred-badge';
            badge.textContent = sub.referrerCode;
            tdRef.appendChild(badge);
          }
          tr.appendChild(tdRef);

          var tdPayout = document.createElement('td');
          var existing = payoutLog[sub.id];
          if (existing) {
            tdPayout.innerHTML = '<span class="payout-result ok">$' + existing.amount +
              (existing.referral ? ' (+$' + existing.referral + ' ref)' : '') + '</span>';
          } else {
            var input = document.createElement('input');
            input.type = 'number';
            input.className = 'payout-input';
            input.placeholder = '0';
            input.min = '0';
            input.step = 'any';
            input.id = 'input-' + sub.id;

            var btn = document.createElement('button');
            btn.className = 'btn btn-pay';
            btn.textContent = 'Pay';
            btn.onclick = function () { assignPayout(sub.id, input, btn, tdPayout); };

            tdPayout.appendChild(input);
            tdPayout.appendChild(document.createTextNode(' '));
            tdPayout.appendChild(btn);
          }
          tr.appendChild(tdPayout);

          tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        block.appendChild(table);
      }

      container.appendChild(block);
    });
  }

  function saveScore(submissionId, score, indicator) {
    if (isNaN(score) || score < 0 || score > 10) return;
    fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: submissionId, score: score }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          indicator.classList.add('show');
          setTimeout(function () { indicator.classList.remove('show'); }, 1500);
        }
      })
      .catch(function (err) { console.error('Score save failed:', err); });
  }

  function assignPayout(submissionId, input, btn, cell) {
    var amount = parseFloat(input.value);
    if (!amount || amount <= 0) { input.style.borderColor = '#f85149'; return; }

    btn.disabled = true;
    btn.textContent = '...';

    fetch('/api/payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: submissionId, amount: amount }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          cell.innerHTML = '<span class="payout-result err">' + data.error + '</span>';
          return;
        }
        var refAmt = data.referralPayout ? data.referralPayout.referralAmount : null;
        payoutLog[submissionId] = { amount: amount, referral: refAmt };

        var msg = '$' + amount.toFixed(2);
        if (refAmt) {
          msg += ' <span class="referred-badge">+$' + refAmt.toFixed(2) + ' referral</span>';
        }
        cell.innerHTML = '<span class="payout-result ok">' + msg + '</span>';
      })
      .catch(function (err) {
        cell.innerHTML = '<span class="payout-result err">Error: ' + err.message + '</span>';
      });
  }

  document.getElementById('export-csv').addEventListener('click', function () {
    var rows = [['Submission ID', 'User', 'Source', 'Score', 'URL', 'Wallet', 'Referred By', 'Payout Amount', 'Referral Bonus']];

    missionsData.forEach(function (mission) {
      mission.submissions.forEach(function (sub) {
        var logged = payoutLog[sub.id];
        if (!logged) return;
        var scoreEl = document.getElementById('input-score-' + sub.id);
        var liveScore = scoreEl ? scoreEl.value : (sub.avgScore !== null ? sub.avgScore.toFixed(2) : '');
        rows.push([sub.id, sub.userTag, sub.source, liveScore, sub.urls[0] || '', sub.wallet || '', sub.referrerCode || '', logged.amount.toFixed(2), logged.referral ? logged.referral.toFixed(2) : '0']);
      });
    });

    if (rows.length <= 1) { alert('No payouts recorded yet. Assign payouts first.'); return; }

    var csv = rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');

    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'payouts-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('filter-status').addEventListener('change', renderPayouts);
  fetchMissions();

  // ==========================================================================
  //  ENGAGEMENT MODULE
  //  API calls go to /eng/api/* which proxies to port 3001
  // ==========================================================================

  var ENG_API = '/eng/api';
  var ENG_REFRESH_INTERVAL = 60000;
  var engCurrentView = 'eng-missions';
  var engCurrentPartnerId = null;

  var engRawMissions = [];
  var engRawLeaderboard = [];
  var engRawPartners = [];

  var engSearchQuery = '';
  var engStatusFilter = 'all';
  var engSortKey = 'engagement-desc';

  // Helpers
  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }
  function pct(n) { return (n * 100).toFixed(2) + '%'; }
  function scoreClass(score) {
    if (score >= 70) return 'score-high';
    if (score >= 40) return 'score-mid';
    return 'score-low';
  }
  function statusClass(status) { return 'status-' + status; }
  function tweetUrl(tweetId, username) { return 'https://x.com/' + (username || 'i') + '/status/' + tweetId; }
  function timeAgo(iso) {
    if (!iso) return 'never';
    var diff = Date.now() - new Date(iso).getTime();
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's ago';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    return Math.floor(hr / 24) + 'd ago';
  }
  function engMatchesSearch(text) {
    if (!engSearchQuery) return true;
    return text.toLowerCase().indexOf(engSearchQuery.toLowerCase()) !== -1;
  }

  // Filter bar
  var engSearchInput = document.getElementById('eng-search-input');
  var engSearchClear = document.getElementById('eng-search-clear');
  var engFilterPills = document.getElementById('eng-filter-pills');
  var engSortControl = document.getElementById('eng-sort-control');
  var engSortSelect = document.getElementById('eng-sort-select');
  var engResultCount = document.getElementById('eng-result-count');

  engSearchInput.addEventListener('input', function () {
    engSearchQuery = engSearchInput.value.trim();
    engSearchClear.classList.toggle('hidden', !engSearchQuery);
    engApplyFilters();
  });

  engSearchClear.addEventListener('click', function () {
    engSearchInput.value = '';
    engSearchQuery = '';
    engSearchClear.classList.add('hidden');
    engApplyFilters();
  });

  document.querySelectorAll('.eng-pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.eng-pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      engStatusFilter = pill.dataset.status;
      engApplyFilters();
    });
  });

  engSortSelect.addEventListener('change', function () {
    engSortKey = engSortSelect.value;
    engApplyFilters();
  });

  function engUpdateFilterBar() {
    engFilterPills.classList.toggle('hidden', engCurrentView !== 'eng-missions');
    engSortControl.classList.toggle('hidden', engCurrentView !== 'eng-leaderboard');

    if (engCurrentView === 'eng-missions') engSearchInput.placeholder = 'Search missions...';
    else if (engCurrentView === 'eng-leaderboard') engSearchInput.placeholder = 'Search by author or mission...';
    else if (engCurrentView === 'eng-partners') engSearchInput.placeholder = 'Search partners...';
    else engSearchInput.placeholder = 'Search...';

    var bar = document.getElementById('eng-filter-bar');
    var isDetail = engCurrentView === 'eng-detail' || engCurrentView === 'eng-partner-detail';
    bar.classList.toggle('hidden', isDetail);
  }

  function engApplyFilters() {
    if (engCurrentView === 'eng-missions') engRenderFilteredMissions();
    else if (engCurrentView === 'eng-leaderboard') engRenderFilteredLeaderboard();
    else if (engCurrentView === 'eng-partners') engRenderFilteredPartners();
  }

  function engSetResultCount(shown, total) {
    if (!engSearchQuery && engStatusFilter === 'all') engResultCount.textContent = total + ' total';
    else if (shown === total) engResultCount.textContent = total + ' total';
    else engResultCount.textContent = shown + ' of ' + total;
  }

  // Navigation
  var engAllViews = ['eng-missions-view', 'eng-leaderboard-view', 'eng-detail-view', 'eng-partners-view', 'eng-partner-detail-view'];

  function engShowView(view) {
    engCurrentView = view;
    engAllViews.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    var target = document.getElementById(view + '-view');
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.eng-nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    engUpdateFilterBar();
  }

  document.querySelectorAll('.eng-nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      engShowView(btn.dataset.view);
      if (btn.dataset.view === 'eng-missions') engLoadMissions();
      if (btn.dataset.view === 'eng-leaderboard') engLoadLeaderboard();
      if (btn.dataset.view === 'eng-partners') engLoadPartners();
    });
  });

  document.getElementById('eng-back-btn').addEventListener('click', function () {
    engShowView('eng-missions');
    engLoadMissions();
  });

  // Missions
  function engRenderMissionCard(m) {
    var card = document.createElement('div');
    card.className = 'mission-card';
    card.addEventListener('click', function () { engLoadMissionDetail(m.missionId); });

    var header = document.createElement('div');
    header.className = 'card-header';

    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = m.title;

    var badge = document.createElement('div');
    badge.className = 'score-badge ' + scoreClass(m.successScore);
    badge.textContent = m.successScore;

    header.appendChild(title);
    header.appendChild(badge);

    var stats = document.createElement('div');
    stats.className = 'card-stats';
    stats.innerHTML =
      '<div class="stat"><div class="stat-value">' + fmt(m.totalImpressions) + '</div><div class="stat-label">Impressions</div></div>' +
      '<div class="stat"><div class="stat-value">' + pct(m.avgEngagementRate) + '</div><div class="stat-label">Eng. Rate</div></div>' +
      '<div class="stat"><div class="stat-value">' + m.submissionCount + '</div><div class="stat-label">Tweets</div></div>';

    var meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.innerHTML = '<span class="status-tag ' + statusClass(m.status) + '">' + m.status + '</span><span>' + new Date(m.deadline).toLocaleDateString() + '</span>';

    card.appendChild(header);
    card.appendChild(stats);
    card.appendChild(meta);
    return card;
  }

  function engRenderFilteredMissions() {
    var grid = document.getElementById('eng-missions-grid');
    grid.innerHTML = '';

    var filtered = engRawMissions.filter(function (m) {
      if (engStatusFilter !== 'all' && m.status !== engStatusFilter) return false;
      if (engSearchQuery) {
        var haystack = (m.title || '') + ' ' + (m.missionId || '');
        if (!engMatchesSearch(haystack)) return false;
      }
      return true;
    });

    engSetResultCount(filtered.length, engRawMissions.length);

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>No Matches</h3><p>' +
        (engRawMissions.length === 0 ? 'No missions found. Run some content missions first.' : 'No missions match your filters.') +
        '</p></div>';
      return;
    }

    filtered.forEach(function (m) { grid.appendChild(engRenderMissionCard(m)); });
  }

  function engLoadMissions() {
    fetch(ENG_API + '/missions?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (missions) {
        engRawMissions = missions;
        engRenderFilteredMissions();
      })
      .catch(function (err) { console.error('[Engagement] Failed to load missions:', err); });
  }

  // Mission Detail
  function engLoadMissionDetail(missionId) {
    fetch(ENG_API + '/missions/' + missionId + '?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        engShowView('eng-detail');

        document.getElementById('eng-detail-title').textContent = data.mission.title;

        var totalImpressions = data.tweets.reduce(function (s, t) { return s + t.impressions; }, 0);
        var totalEng = data.tweets.reduce(function (s, t) { return s + t.totalEngagement; }, 0);
        var avgRate = data.tweets.length > 0
          ? data.tweets.reduce(function (s, t) { return s + t.engagementRate; }, 0) / data.tweets.length : 0;

        document.getElementById('eng-detail-stats').innerHTML =
          '<div class="stat"><div class="stat-value">' + fmt(totalImpressions) + '</div><div class="stat-label">Total Impressions</div></div>' +
          '<div class="stat"><div class="stat-value">' + fmt(totalEng) + '</div><div class="stat-label">Total Engagement</div></div>' +
          '<div class="stat"><div class="stat-value">' + pct(avgRate) + '</div><div class="stat-label">Avg Eng. Rate</div></div>' +
          '<div class="stat"><div class="stat-value">' + data.tweets.length + '</div><div class="stat-label">Tracked Tweets</div></div>';

        var tbody = document.querySelector('#eng-detail-table tbody');
        tbody.innerHTML = '';

        data.tweets.forEach(function (t, i) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + (i + 1) + '</td><td>@' + t.authorUsername + '</td><td class="num">' + fmt(t.authorFollowerCount) + '</td>' +
            '<td class="num">' + fmt(t.impressions) + '</td><td class="num">' + fmt(t.likes) + '</td><td class="num">' + fmt(t.retweets) + '</td>' +
            '<td class="num">' + fmt(t.replies) + '</td><td class="num">' + fmt(t.quotes) + '</td><td class="num">' + fmt(t.bookmarks) + '</td>' +
            '<td class="num">' + pct(t.engagementRate) + '</td><td><a href="' + tweetUrl(t.tweetId, t.authorUsername) + '" target="_blank">View</a></td>';
          tbody.appendChild(tr);
        });

        if (data.tweets.length === 0) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="11" style="text-align:center;color:#8b949e;padding:2rem">No tweet metrics tracked yet. Click Refresh to poll Twitter API.</td>';
          tbody.appendChild(tr);
        }
      })
      .catch(function (err) { console.error('[Engagement] Failed to load mission detail:', err); });
  }

  // Leaderboard
  function engSortLeaderboard(entries) {
    var parts = engSortKey.split('-');
    var field = parts[0];
    var dir = parts[1] === 'asc' ? 1 : -1;
    var keyMap = { engagement: 'totalEngagement', impressions: 'impressions', rate: 'engagementRate', likes: 'likes', retweets: 'retweets' };
    var key = keyMap[field] || 'totalEngagement';
    return entries.slice().sort(function (a, b) { return (b[key] - a[key]) * dir; });
  }

  function engRenderFilteredLeaderboard() {
    var tbody = document.querySelector('#eng-leaderboard-table tbody');
    tbody.innerHTML = '';

    var filtered = engRawLeaderboard.filter(function (e) {
      if (!engSearchQuery) return true;
      return engMatchesSearch('@' + e.authorUsername + ' ' + e.missionTitle);
    });

    var sorted = engSortLeaderboard(filtered);
    engSetResultCount(sorted.length, engRawLeaderboard.length);

    if (sorted.length === 0) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="10" style="text-align:center;color:#8b949e;padding:2rem">' +
        (engRawLeaderboard.length === 0 ? 'No engagement data yet.' : 'No results match your search.') + '</td>';
      tbody.appendChild(tr);
      return;
    }

    sorted.forEach(function (e, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (i + 1) + '</td><td>@' + e.authorUsername + '</td><td>' + e.missionTitle + '</td>' +
        '<td class="num">' + fmt(e.impressions) + '</td><td class="num">' + fmt(e.likes) + '</td><td class="num">' + fmt(e.retweets) + '</td>' +
        '<td class="num">' + fmt(e.replies) + '</td><td class="num">' + fmt(e.totalEngagement) + '</td><td class="num">' + pct(e.engagementRate) + '</td>' +
        '<td><a href="' + tweetUrl(e.tweetId, e.authorUsername) + '" target="_blank">View</a></td>';
      tbody.appendChild(tr);
    });
  }

  function engLoadLeaderboard() {
    fetch(ENG_API + '/leaderboard?limit=100&t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (entries) {
        engRawLeaderboard = entries;
        engRenderFilteredLeaderboard();
      })
      .catch(function (err) { console.error('[Engagement] Failed to load leaderboard:', err); });
  }

  // Partners
  function engRenderPartnerCard(p) {
    var card = document.createElement('div');
    card.className = 'partner-card';
    card.addEventListener('click', function () { engLoadPartnerDetail(p.id); });

    var header = document.createElement('div');
    header.className = 'card-header';

    var titleWrap = document.createElement('div');
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = p.name;
    titleWrap.appendChild(title);

    if (p.handle) {
      var handle = document.createElement('div');
      handle.className = 'card-handle';
      handle.textContent = '@' + p.handle;
      titleWrap.appendChild(handle);
    }

    var clipBadge = document.createElement('div');
    clipBadge.className = 'score-badge ' + (p.clipCount > 0 ? 'score-high' : 'score-low');
    clipBadge.textContent = p.clipCount + ' clips';

    header.appendChild(titleWrap);
    header.appendChild(clipBadge);

    var stats = document.createElement('div');
    stats.className = 'card-stats';
    stats.innerHTML =
      '<div class="stat"><div class="stat-value">' + fmt(p.totalViews) + '</div><div class="stat-label">Total Views</div></div>' +
      '<div class="stat"><div class="stat-value">' + fmt(p.avgViews) + '</div><div class="stat-label">Avg Views</div></div>' +
      '<div class="stat"><div class="stat-value">' + p.uniqueClippers + '</div><div class="stat-label">Distributors</div></div>';

    card.appendChild(header);
    card.appendChild(stats);
    return card;
  }

  function engRenderFilteredPartners() {
    var grid = document.getElementById('eng-partners-grid');
    grid.innerHTML = '';

    var filtered = engRawPartners.filter(function (p) {
      if (!engSearchQuery) return true;
      return engMatchesSearch(p.name + ' ' + (p.handle || ''));
    });

    engSetResultCount(filtered.length, engRawPartners.length);

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="empty-state"><h3>' +
        (engRawPartners.length === 0 ? 'No Partners' : 'No Matches') + '</h3><p>' +
        (engRawPartners.length === 0 ? 'Add a partner to start tracking clip performance.' : 'No partners match your search.') +
        '</p></div>';
      return;
    }

    filtered.forEach(function (p) { grid.appendChild(engRenderPartnerCard(p)); });
  }

  function engLoadPartners() {
    fetch(ENG_API + '/partners?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (partners) {
        engRawPartners = partners;
        engRenderFilteredPartners();
      })
      .catch(function (err) { console.error('[Engagement] Failed to load partners:', err); });
  }

  // Add partner
  document.getElementById('eng-add-partner-btn').addEventListener('click', function () {
    document.getElementById('eng-add-partner-form').classList.remove('hidden');
    document.getElementById('eng-partner-name').focus();
  });

  document.getElementById('eng-cancel-partner-btn').addEventListener('click', function () {
    document.getElementById('eng-add-partner-form').classList.add('hidden');
    document.getElementById('eng-partner-name').value = '';
    document.getElementById('eng-partner-handle').value = '';
  });

  document.getElementById('eng-save-partner-btn').addEventListener('click', function () {
    var name = document.getElementById('eng-partner-name').value.trim();
    var handle = document.getElementById('eng-partner-handle').value.trim().replace(/^@/, '');
    if (!name) return;

    var btn = document.getElementById('eng-save-partner-btn');
    btn.disabled = true;
    fetch(ENG_API + '/partners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, handle: handle || undefined })
    })
      .then(function (res) { return res.json(); })
      .then(function () {
        document.getElementById('eng-add-partner-form').classList.add('hidden');
        document.getElementById('eng-partner-name').value = '';
        document.getElementById('eng-partner-handle').value = '';
        btn.disabled = false;
        engLoadPartners();
      })
      .catch(function () { btn.disabled = false; });
  });

  // Partner detail
  document.getElementById('eng-partner-back-btn').addEventListener('click', function () {
    engShowView('eng-partners');
    engLoadPartners();
  });

  function engLoadPartnerDetail(partnerId) {
    engCurrentPartnerId = partnerId;
    fetch(ENG_API + '/partners/' + partnerId + '?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        engShowView('eng-partner-detail');

        document.getElementById('eng-partner-detail-title').textContent =
          data.partner.name + (data.partner.handle ? ' (@' + data.partner.handle + ')' : '');

        document.getElementById('eng-partner-detail-stats').innerHTML =
          '<div class="stat"><div class="stat-value">' + fmt(data.stats.totalViews) + '</div><div class="stat-label">Total Views</div></div>' +
          '<div class="stat"><div class="stat-value">' + fmt(data.stats.avgViews) + '</div><div class="stat-label">Avg Views/Clip</div></div>' +
          '<div class="stat"><div class="stat-value">' + fmt(data.stats.totalEngagement) + '</div><div class="stat-label">Total Engagement</div></div>' +
          '<div class="stat"><div class="stat-value">' + pct(data.stats.avgEngagementRate) + '</div><div class="stat-label">Avg Eng. Rate</div></div>' +
          '<div class="stat"><div class="stat-value">' + data.stats.clipCount + '</div><div class="stat-label">Clips</div></div>' +
          '<div class="stat"><div class="stat-value">' + data.stats.uniqueClippers + '</div><div class="stat-label">Distributors</div></div>';

        var tbody = document.querySelector('#eng-partner-clips-table tbody');
        tbody.innerHTML = '';

        if (data.clips.length === 0) {
          var tr = document.createElement('tr');
          tr.innerHTML = '<td colspan="13" style="text-align:center;color:#8b949e;padding:2rem">No clips yet. Add tweet URLs to track clip performance.</td>';
          tbody.appendChild(tr);
          return;
        }

        data.clips.forEach(function (c, i) {
          var tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + (i + 1) + '</td><td>@' + c.postedBy + '</td><td class="num">' + fmt(c.authorFollowerCount) + '</td>' +
            '<td class="num">' + fmt(c.impressions) + '</td><td class="num">' + fmt(c.likes) + '</td><td class="num">' + fmt(c.retweets) + '</td>' +
            '<td class="num">' + fmt(c.replies) + '</td><td class="num">' + fmt(c.quotes) + '</td><td class="num">' + fmt(c.bookmarks) + '</td>' +
            '<td class="num">' + pct(c.engagementRate) + '</td><td>' + (c.note || '') + '</td>' +
            '<td><a href="' + tweetUrl(c.tweetId, c.postedBy) + '" target="_blank">View</a></td>' +
            '<td><button class="btn-delete" data-clip-id="' + c.id + '">x</button></td>';
          tbody.appendChild(tr);
        });

        tbody.querySelectorAll('.btn-delete').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!confirm('Remove this clip?')) return;
            fetch(ENG_API + '/partners/' + partnerId + '/clips/' + btn.dataset.clipId, { method: 'DELETE' })
              .then(function () { engLoadPartnerDetail(partnerId); });
          });
        });
      })
      .catch(function (err) { console.error('[Engagement] Failed to load partner detail:', err); });
  }

  document.getElementById('eng-delete-partner-btn').addEventListener('click', function () {
    if (!engCurrentPartnerId) return;
    if (!confirm('Remove this partner and all their clips?')) return;
    fetch(ENG_API + '/partners/' + engCurrentPartnerId, { method: 'DELETE' })
      .then(function () {
        engShowView('eng-partners');
        engLoadPartners();
      });
  });

  // Add clip
  document.getElementById('eng-add-clip-btn').addEventListener('click', function () {
    document.getElementById('eng-add-clip-form').classList.remove('hidden');
    document.getElementById('eng-clip-url').focus();
  });

  document.getElementById('eng-cancel-clip-btn').addEventListener('click', function () {
    document.getElementById('eng-add-clip-form').classList.add('hidden');
    document.getElementById('eng-clip-url').value = '';
    document.getElementById('eng-clip-note').value = '';
  });

  document.getElementById('eng-save-clip-btn').addEventListener('click', function () {
    var url = document.getElementById('eng-clip-url').value.trim();
    var note = document.getElementById('eng-clip-note').value.trim();
    if (!url || !engCurrentPartnerId) return;

    var btn = document.getElementById('eng-save-clip-btn');
    btn.disabled = true;
    btn.textContent = 'Adding...';
    fetch(ENG_API + '/partners/' + engCurrentPartnerId + '/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, note: note || undefined })
    })
      .then(function (res) { return res.json(); })
      .then(function () {
        document.getElementById('eng-add-clip-form').classList.add('hidden');
        document.getElementById('eng-clip-url').value = '';
        document.getElementById('eng-clip-note').value = '';
        btn.disabled = false;
        btn.textContent = 'Add';
        engLoadPartnerDetail(engCurrentPartnerId);
      })
      .catch(function () { btn.disabled = false; btn.textContent = 'Add'; });
  });

  // Refresh
  var engRefreshBtn = document.getElementById('eng-refresh-btn');
  engRefreshBtn.addEventListener('click', function () {
    engRefreshBtn.disabled = true;
    engRefreshBtn.textContent = 'Refreshing...';

    fetch(ENG_API + '/refresh?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (result) {
        engRefreshBtn.textContent = result.success ? 'Done!' : result.message;
        setTimeout(function () { engRefreshBtn.textContent = 'Refresh'; engRefreshBtn.disabled = false; }, 3000);

        if (result.success) {
          if (engCurrentView === 'eng-missions') engLoadMissions();
          if (engCurrentView === 'eng-leaderboard') engLoadLeaderboard();
          if (engCurrentView === 'eng-partners') engLoadPartners();
          if (engCurrentView === 'eng-partner-detail' && engCurrentPartnerId) engLoadPartnerDetail(engCurrentPartnerId);
        }
      })
      .catch(function () {
        engRefreshBtn.textContent = 'Error';
        setTimeout(function () { engRefreshBtn.textContent = 'Refresh'; engRefreshBtn.disabled = false; }, 3000);
      });
  });

  // Status
  function engLoadStatus() {
    fetch(ENG_API + '/status?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var info = document.getElementById('eng-status-info');
        var parts = [data.trackedTweets + ' tweets'];
        if (data.trackedPartners > 0) parts.push(data.trackedPartners + ' partners, ' + data.trackedClips + ' clips');
        info.textContent = parts.join(' | ') + ' | Last poll: ' + timeAgo(data.lastPollAt);
      })
      .catch(function () {});
  }

  // Auto-refresh engagement when tab is active
  setInterval(function () {
    if (!engagementLoaded) return;
    var activeTab = document.querySelector('.hub-tab.active');
    if (!activeTab || activeTab.dataset.tab !== 'engagement') return;

    if (engCurrentView === 'eng-missions') engLoadMissions();
    if (engCurrentView === 'eng-leaderboard') engLoadLeaderboard();
    if (engCurrentView === 'eng-partners') engLoadPartners();
    if (engCurrentView === 'eng-partner-detail' && engCurrentPartnerId) engLoadPartnerDetail(engCurrentPartnerId);
    engLoadStatus();
  }, ENG_REFRESH_INTERVAL);

  engUpdateFilterBar();
})();
