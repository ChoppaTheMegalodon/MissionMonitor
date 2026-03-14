(function () {
  'use strict';

  var missionsData = [];
  var payoutLog = {}; // submissionId -> { amount, referral }

  function fetchMissions() {
    fetch('/api/missions?t=' + Date.now())
      .then(function (res) { return res.json(); })
      .then(function (data) {
        missionsData = data;
        render();
      })
      .catch(function (err) {
        console.error('Failed to fetch missions:', err);
        document.getElementById('missions-container').innerHTML =
          '<div class="empty-state">Failed to load missions</div>';
      });
  }

  function render() {
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

      // Header
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

      // Submissions table
      if (mission.submissions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No submissions';
        block.appendChild(empty);
      } else {
        var table = document.createElement('table');
        var thead = document.createElement('thead');
        thead.innerHTML =
          '<tr>' +
          '<th>#</th>' +
          '<th>User</th>' +
          '<th>Source</th>' +
          '<th>Score</th>' +
          '<th>URL</th>' +
          '<th>Wallet</th>' +
          '<th>Referred</th>' +
          '<th>Payout</th>' +
          '</tr>';
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        mission.submissions.forEach(function (sub, idx) {
          var tr = document.createElement('tr');
          tr.setAttribute('data-sub-id', sub.id);

          // Rank
          var tdRank = document.createElement('td');
          tdRank.textContent = (idx + 1).toString();
          tr.appendChild(tdRank);

          // User
          var tdUser = document.createElement('td');
          tdUser.textContent = sub.userTag;
          tr.appendChild(tdUser);

          // Source
          var tdSource = document.createElement('td');
          tdSource.textContent = sub.source;
          tr.appendChild(tdSource);

          // Score (editable)
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

          // URL
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

          // Wallet
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

          // Referred
          var tdRef = document.createElement('td');
          if (sub.referred) {
            var badge = document.createElement('span');
            badge.className = 'referred-badge';
            badge.textContent = sub.referrerCode;
            tdRef.appendChild(badge);
          }
          tr.appendChild(tdRef);

          // Payout
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
      .catch(function (err) {
        console.error('Score save failed:', err);
      });
  }

  function assignPayout(submissionId, input, btn, cell) {
    var amount = parseFloat(input.value);
    if (!amount || amount <= 0) {
      input.style.borderColor = '#f85149';
      return;
    }

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

  // CSV export of all payouts recorded in this session
  document.getElementById('export-csv').addEventListener('click', function () {
    var rows = [['Submission ID', 'User', 'Source', 'Score', 'URL', 'Wallet', 'Referred By', 'Payout Amount', 'Referral Bonus']];

    missionsData.forEach(function (mission) {
      mission.submissions.forEach(function (sub) {
        var logged = payoutLog[sub.id];
        if (!logged) return; // only export paid submissions

        // Read live score from input if present
        var scoreEl = document.getElementById('input-score-' + sub.id);
        var liveScore = scoreEl ? scoreEl.value : (sub.avgScore !== null ? sub.avgScore.toFixed(2) : '');

        rows.push([
          sub.id,
          sub.userTag,
          sub.source,
          liveScore,
          sub.urls[0] || '',
          sub.wallet || '',
          sub.referrerCode || '',
          logged.amount.toFixed(2),
          logged.referral ? logged.referral.toFixed(2) : '0',
        ]);
      });
    });

    if (rows.length <= 1) {
      alert('No payouts recorded yet. Assign payouts first.');
      return;
    }

    var csv = rows.map(function (r) {
      return r.map(function (c) {
        return '"' + String(c).replace(/"/g, '""') + '"';
      }).join(',');
    }).join('\n');

    var blob = new Blob([csv], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'payouts-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('filter-status').addEventListener('change', render);

  fetchMissions();
})();
