const UI = {
  navigateToPage: function(page) {
    const baseUrl = document.body.dataset.webAppUrl;
    const targetUrl = baseUrl
      ? baseUrl + '?page=' + encodeURIComponent(page)
      : '?page=' + encodeURIComponent(page);
    window.top.location.href = targetUrl;
  },

  showLoading: function(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>';
  },
  
  showAlert: function(containerId, message, type = 'danger') {
    const container = document.getElementById(containerId);
    if (container) {
      const alert = document.createElement('div');
      alert.className = 'alert alert-' + type + ' alert-dismissible fade show';
      alert.setAttribute('role', 'alert');
      alert.appendChild(document.createTextNode(message));
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'btn-close';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.addEventListener('click', function () {
        alert.remove();
      });
      alert.appendChild(closeButton);
      container.replaceChildren(alert);
    }
  },

  runServerFunction: function(functionName, argsArray, successCallback, errorCallback) {
    if (typeof google !== 'undefined' && google.script && google.script.run) {
      let runner = google.script.run
        .withSuccessHandler(successCallback)
        .withFailureHandler(errorCallback || function(err) {
          console.error("Server Call Error:", err);
          alert("A system error occurred: " + err.message);
        });
      runner[functionName].apply(runner, argsArray);
    } else {
      const error = new Error('This action is available only in the deployed MindBridge web app.');
      if (errorCallback) {
        errorCallback(error);
      } else {
        console.error(error.message);
        alert(error.message);
      }
    }
  },

  loadStudentPortal: function(section) {
    const token = sessionStorage.getItem('mindbridge_session_token');
    let clientUser = null;
    try {
      clientUser = JSON.parse(sessionStorage.getItem('mindbridge_user') || 'null');
    } catch (error) {
      sessionStorage.removeItem('mindbridge_user');
    }

    if (!token || !clientUser || clientUser.role !== 'STUDENT') {
      UI.navigateToPage('login');
      return;
    }

    const page = document.querySelector('[data-portal-section]');
    const message = page && page.querySelector('[data-portal-message]');
    if (!page || !message) return;

    UI.activateStudentNavigation();
    google.script.run.withSuccessHandler(function(result) {
      if (!result || !result.success) {
        UI.showPortalError(message, result && result.error ? result.error : 'Unable to load this page.');
        return;
      }

      const name = result.profile.name || 'Student';
      document.querySelectorAll('[data-student-name]').forEach(function(element) {
        element.textContent = name;
      });
      document.querySelectorAll('[data-student-profile-name]').forEach(function(element) {
        element.textContent = name;
      });
      const navName = document.getElementById('student-nav-name');
      if (navName) navName.textContent = name;

      message.hidden = true;
      page.querySelectorAll('[data-portal-content]').forEach(function(element) {
        element.hidden = false;
      });
      UI.renderStudentPortal(section, result);
    }).withFailureHandler(function(error) {
      UI.showPortalError(message, error && error.message ? error.message : 'Unable to load this page. Please try again.');
    }).getStudentPortalData(token, section);
  },

  activateStudentNavigation: function() {
    const pageKey = document.body.dataset.pageKey || '';
    const activeRoute = pageKey === 'student' ? 'student-dashboard' : pageKey;
    document.querySelectorAll('[data-student-route]').forEach(function(link) {
      if (link.dataset.studentRoute === activeRoute) {
        link.setAttribute('aria-current', 'page');
      }
    });

    const toggle = document.querySelector('.student-nav-toggle');
    const navigation = document.getElementById('student-navigation');
    if (toggle && navigation) {
      toggle.addEventListener('click', function() {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        navigation.classList.toggle('is-open', !expanded);
      });
    }

    const logoutButton = document.getElementById('student-logout-button');
    if (logoutButton) {
      logoutButton.addEventListener('click', function() {
        logoutButton.disabled = true;
        const token = sessionStorage.getItem('mindbridge_session_token');
        const clearLocalSession = function() {
          sessionStorage.removeItem('mindbridge_user');
          sessionStorage.removeItem('mindbridge_session_token');
          UI.navigateToPage('login');
        };
        if (!token || !google.script || !google.script.run) {
          clearLocalSession();
          return;
        }
        google.script.run.withSuccessHandler(clearLocalSession)
          .withFailureHandler(function() {
            clearLocalSession();
          })
          .logoutUser(token);
      });
    }
  },

  showPortalError: function(container, text) {
    if (/session (has been )?(expired|invalid)|not authorized/i.test(text)) {
      sessionStorage.removeItem('mindbridge_user');
      sessionStorage.removeItem('mindbridge_session_token');
      UI.navigateToPage('login');
      return;
    }
    container.textContent = text;
    container.className = 'portal-message portal-message-error';
    container.hidden = false;
  },

  loadCounselorPortal: function(route) {
    let storedUser = null;
    try {
      storedUser = JSON.parse(sessionStorage.getItem('mindbridge_user') || 'null');
    } catch (error) {
      sessionStorage.removeItem('mindbridge_user');
    }
    const token = sessionStorage.getItem('mindbridge_session_token');
    if (!storedUser || storedUser.role !== 'COUNSELOR' || !token) {
      UI.navigateToPage('counselor_login');
      return;
    }
    UI.activateCounselorNavigation(route);
    const root = document.getElementById('counselor-portal');
    if (!root) return;
    const userLabel = root.querySelector('[data-counselor-name]');
    if (userLabel) userLabel.textContent = storedUser.name || storedUser.email || '';

    const key = route === 'counselor' ? 'dashboard' : route.replace(/^counselor-/, '');
    const sections = {
      dashboard: ['Dashboard', 'Current student support activity from MindBridge records.'],
      students: ['Student Management', 'Search and review student account and screening records.'],
      student: ['Student Record', 'Counselor-authorized student details and saved records.'],
      screenings: ['Screening Records', 'Saved assessments and stored item responses.'],
      risks: ['Risk Monitoring', 'Automated risk notifications for human review.'],
      followups: ['Counseling & Follow-ups', 'Existing follow-up status records; no appointment scheduler is configured.'],
      reports: ['Reports & Analytics', 'Aggregate counts from the configured monitoring period.'],
      resources: ['Wellness Resources', 'Counselor-approved resources currently published in MindBridge.'],
      profile: ['My Profile', 'Counselor account details.'],
      settings: ['Settings', 'Settings supported by this account.']
    };
    const metadata = sections[key] || sections.dashboard;
    root.querySelector('[data-counselor-title]').textContent = metadata[0];
    root.querySelector('[data-counselor-description]').textContent = metadata[1];
    const message = root.querySelector('[data-counselor-message]');
    const panel = root.querySelector('[data-counselor-' + key + ']') ||
      (key === 'settings' ? root.querySelector('[data-counselor-profile]') : null);
    if (panel) panel.hidden = false;

    const methods = {
      dashboard: function() {
        google.script.run.withSuccessHandler(function(result) {
          if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load dashboard.');
          UI.renderCounselorDashboard(root, result);
        }).withFailureHandler(function(error) {
          UI.showCounselorError(message, error, 'Unable to load dashboard.');
        }).getCounselorDashboardData(token);
      },
      students: function() { UI.loadCounselorStudents(root, token, message); },
      student: function() {
        const profileId = new URLSearchParams(window.location.search).get('id');
        google.script.run.withSuccessHandler(function(result) {
          if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load student record.');
          message.hidden = true;
          UI.renderCounselorStudent(root, result);
        }).withFailureHandler(function(error) {
          UI.showCounselorError(message, error, 'Unable to load student record.');
        }).getCounselorStudentRecord(token, profileId);
      },
      screenings: function() {
        UI.loadCounselorScreenings(root, token, message);
      },
      risks: function() { UI.loadCounselorRisks(root, token, message); },
      followups: function() { UI.loadCounselorFollowups(root, token, message); },
      reports: function() {
        google.script.run.withSuccessHandler(function(result) {
          if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load reports.');
          message.hidden = true;
          UI.renderCounselorReports(root, result);
        }).withFailureHandler(function(error) {
          UI.showCounselorError(message, error, 'Unable to load reports.');
        }).getCounselorReports(token);
      },
      resources: function() {
        google.script.run.withSuccessHandler(function(result) {
          if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load resources.');
          message.hidden = true;
          UI.renderCounselorResources(root, result.data || []);
        }).withFailureHandler(function(error) {
          UI.showCounselorError(message, error, 'Unable to load resources.');
        }).getCounselorResources(token);
      },
      profile: function() { UI.loadCounselorProfile(root, token, message); },
      settings: function() { UI.loadCounselorProfile(root, token, message); }
    };
    (methods[key] || methods.dashboard)();
  },

  activateCounselorNavigation: function(route) {
    document.querySelectorAll('[data-counselor-route]').forEach(function(link) {
      if (link.dataset.counselorRoute === route) link.setAttribute('aria-current', 'page');
    });
    const toggle = document.querySelector('.counselor-nav-toggle');
    const nav = document.getElementById('counselor-navigation');
    if (toggle && nav) {
      toggle.addEventListener('click', function() {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        nav.classList.toggle('is-open', !expanded);
      });
    }
    const logout = document.getElementById('counselor-logout-button');
    if (logout) {
      logout.addEventListener('click', function() {
        logout.disabled = true;
        const token = sessionStorage.getItem('mindbridge_session_token');
        const clear = function() {
          sessionStorage.removeItem('mindbridge_user');
          sessionStorage.removeItem('mindbridge_session_token');
          UI.navigateToPage('counselor_login');
        };
        if (!token || !google.script || !google.script.run) return clear();
        google.script.run.withSuccessHandler(clear).withFailureHandler(clear).logoutUser(token);
      });
    }
  },

  showCounselorError: function(container, error, fallback) {
    const text = error && error.message ? error.message : fallback;
    if (/session (has been )?(expired|invalid)|not authorized/i.test(text)) {
      sessionStorage.removeItem('mindbridge_user');
      sessionStorage.removeItem('mindbridge_session_token');
      UI.navigateToPage('counselor_login');
      return;
    }
    UI.showPortalError(container, text || 'The counselor request failed. Please try again.');
  },

  renderCounselorDashboard: function(root, data) {
    const message = root.querySelector('[data-counselor-message]');
    message.hidden = true;
    const name = root.querySelector('[data-counselor-name]');
    if (name) name.textContent = data.counselor.name || data.counselor.email || '';
    const links = {
      students: 'counselor-students',
      screenings: 'counselor-screenings',
      screeningReviews: 'counselor-risks',
      priorityScreeningReviews: 'counselor-risks',
      reviewedScreenings: 'counselor-screenings',
      pendingRisks: 'counselor-risks',
      pendingAIReviews: 'counselor-reviews',
      followUps: 'counselor-followups'
    };
    const labels = {
      students: 'Active students',
      screenedThisWeek: 'DASS-21 screenings (last 7 days)',
      screeningReviews: 'Pending screening reviews',
      priorityScreeningReviews: 'Priority reviews requiring attention',
      reviewedScreenings: 'Reviewed screenings',
      pendingRisks: 'Pending risk notifications',
      pendingAIReviews: 'Pending AI response reviews',
      followUps: 'Follow-ups in progress'
    };
    const grid = root.querySelector('[data-dashboard-metrics]');
    grid.replaceChildren();
    Object.keys(labels).forEach(function(key) {
      const card = document.createElement('article');
      card.className = 'counselor-metric-card';
      const anchor = document.createElement('a');
      anchor.href = '?page=' + (links[key] || 'counselor-screenings');
      const label = document.createElement('p');
      label.textContent = labels[key];
      const count = document.createElement('strong');
      count.textContent = String(data.counts[key]);
      anchor.append(label, count);
      card.appendChild(anchor);
      grid.appendChild(card);
    });
    const alerts = root.querySelector('[data-dashboard-alerts]');
    alerts.replaceChildren();
    if (!data.recentAlerts.length) {
      UI.appendPortalEmpty(alerts, 'No risk notifications have been recorded.');
      return;
    }
    data.recentAlerts.forEach(function(alertRow) {
      const item = document.createElement('p');
      item.textContent = alertRow.trigger_type + ' · ' + alertRow.status +
        ' · ' + UI.formatPortalDate(alertRow.created_at);
      alerts.appendChild(item);
    });
  },

  appendPortalEmpty: function(container, text) {
    const empty = document.createElement('p');
    empty.className = 'portal-empty-state';
    empty.textContent = text;
    container.appendChild(empty);
  },

  renderCounselorTable: function(container, headings, rows) {
    container.replaceChildren();
    if (!rows.length) return UI.appendPortalEmpty(container, 'No records are available.');
    const table = document.createElement('table');
    table.className = 'counselor-data-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headings.forEach(function(heading) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = heading;
      headerRow.appendChild(cell);
    });
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    rows.forEach(function(values) {
      const row = document.createElement('tr');
      values.forEach(function(value) {
        const cell = document.createElement('td');
        if (value instanceof Node) cell.appendChild(value);
        else cell.textContent = value === null || value === undefined ? '' : String(value);
        row.appendChild(cell);
      });
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    container.appendChild(table);
  },

  loadCounselorStudents: function(root, token, message) {
    const input = root.querySelector('#counselor-student-search');
    const load = function() {
      const button = root.querySelector('[data-student-search]');
      if (button) button.disabled = true;
      google.script.run.withSuccessHandler(function(result) {
        if (button) button.disabled = false;
        if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load students.');
        message.hidden = true;
        const rows = (result.data || []).map(function(student) {
          const view = document.createElement('button');
          view.type = 'button';
          view.textContent = 'View record';
          view.addEventListener('click', function() {
            const url = new URL(window.location.href);
            url.searchParams.set('page', 'counselor-student');
            url.searchParams.set('id', student.id);
            window.top.location.href = url.toString();
          });
          return [
            student.student_number,
            [student.first_name, student.last_name].filter(Boolean).join(' '),
            student.course,
            student.year_level,
            student.accountStatus,
            view
          ];
        });
        UI.renderCounselorTable(root.querySelector('[data-student-list]'), ['Student number', 'Name', 'Course', 'Year', 'Account status', 'Record'], rows);
        root.querySelector('[data-student-limit]').textContent = result.data.length === result.limit
          ? 'Showing the first ' + result.limit + ' records. Use search to narrow results.'
          : '';
      }).withFailureHandler(function(error) {
        if (button) button.disabled = false;
        UI.showCounselorError(message, error, 'Unable to load students.');
      }).getCounselorStudents(token, input.value);
    };
    const searchButton = root.querySelector('[data-student-search]');
    if (!searchButton.dataset.bound) {
      searchButton.dataset.bound = 'true';
      searchButton.addEventListener('click', load);
      input.addEventListener('keydown', function(event) { if (event.key === 'Enter') load(); });
    }
    load();
  },

  renderCounselorStudent: function(root, result) {
    const profile = result.profile;
    const account = result.account || {};
    const container = root.querySelector('[data-counselor-student] [data-student-detail]') ||
      root.querySelector('[data-student-detail]');
    container.replaceChildren();
    container.hidden = false;
    const heading = document.createElement('h2');
    heading.textContent = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.student_number;
    container.appendChild(heading);
    const details = document.createElement('dl');
    [
      ['Student identifier', profile.student_number],
      ['Institutional email', account.email],
      ['Course / program', profile.course],
      ['Year level', profile.year_level],
      ['Account status', account.status],
      ['Account role', account.role]
    ].forEach(function(pair) {
      const term = document.createElement('dt');
      term.textContent = pair[0];
      const value = document.createElement('dd');
      value.textContent = pair[1] === undefined || pair[1] === null ? 'Not recorded' : String(pair[1]);
      details.append(term, value);
    });
    container.appendChild(details);
    const screeningHeading = document.createElement('h3');
    screeningHeading.textContent = 'Recent screening records';
    container.appendChild(screeningHeading);
    const screeningRows = (result.assessments || []).map(function(item) {
      if (item.type === 'DASS21') {
        return [
          UI.formatPortalDate(item.created_at),
          item.type,
          item.subscales.depression.score + ' · ' + item.subscales.depression.severity,
          item.subscales.anxiety.score + ' · ' + item.subscales.anxiety.severity,
          item.subscales.stress.score + ' · ' + item.subscales.stress.severity,
          item.review_status
        ];
      }
      return [UI.formatPortalDate(item.created_at), item.type, item.total_score, item.severity || 'Not recorded'];
    });
    UI.renderCounselorTable(
      container.appendChild(document.createElement('div')),
      ['Date', 'Type', 'Depression', 'Anxiety', 'Stress', 'Review status'],
      screeningRows
    );
    const riskHeading = document.createElement('h3');
    riskHeading.textContent = 'Risk notification history';
    container.appendChild(riskHeading);
    const riskRows = (result.riskFlags || []).map(function(item) {
      return [UI.formatPortalDate(item.created_at), item.trigger_type, item.severity, item.status];
    });
    UI.renderCounselorTable(container.appendChild(document.createElement('div')), ['Date', 'Trigger', 'Severity', 'Status'], riskRows);
  },

  loadCounselorScreenings: function(root, token, message) {
    const filters = {
      fromDate: root.querySelector('[data-screening-from]').value,
      toDate: root.querySelector('[data-screening-to]').value,
      reviewStatus: root.querySelector('[data-screening-status]').value,
      priority: root.querySelector('[data-screening-priority]').value
    };
    google.script.run.withSuccessHandler(function(result) {
      if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load screening records.');
      message.hidden = true;
      UI.renderCounselorScreenings(root, result, token);
    }).withFailureHandler(function(error) {
      UI.showCounselorError(message, error, 'Unable to load screening records.');
    }).getCounselorScreenings(token, filters);
    const filterButton = root.querySelector('[data-screening-filter]');
    if (!filterButton.dataset.bound) {
      filterButton.dataset.bound = 'true';
      filterButton.addEventListener('click', function() {
        UI.loadCounselorScreenings(root, token, message);
      });
    }
  },

  renderCounselorScreenings: function(root, result, token) {
    const container = root.querySelector('[data-screening-list]');
    const rows = (result.data || []).map(function(item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Review';
      button.addEventListener('click', function() {
        const target = root.querySelector('[data-screening-detail]');
        target.replaceChildren();
        const title = document.createElement('h3');
        title.textContent = 'DASS-21 screening review';
        target.appendChild(title);
        const summary = document.createElement('p');
        summary.textContent = 'Student: ' + (item.student ? item.student.student_number : 'Identifier unavailable') +
          ' · Submitted: ' + new Date(item.created_at).toLocaleString() +
          ' · Review status: ' + item.review_status +
          ' · Review priority: ' + item.priority;
        target.appendChild(summary);
        if (item.reviewed_at) {
          const reviewTime = document.createElement('p');
          reviewTime.textContent = 'Last review update: ' + new Date(item.reviewed_at).toLocaleString();
          target.appendChild(reviewTime);
        }
        const subscores = document.createElement('div');
        subscores.className = 'counselor-metric-grid';
        Object.keys(item.subscales).forEach(function(name) {
          const card = document.createElement('article');
          card.className = 'counselor-metric-card';
          const label = document.createElement('p');
          label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
          const score = document.createElement('strong');
          score.textContent = item.subscales[name].score + ' · ' + item.subscales[name].severity;
          card.append(label, score);
          subscores.appendChild(card);
        });
        target.appendChild(subscores);
        const disclaimer = document.createElement('p');
        disclaimer.className = 'portal-muted';
        disclaimer.textContent = 'Automated bands are not diagnoses. Counselor judgment and the approved protocol govern follow-up.';
        target.appendChild(disclaimer);
        const actions = document.createElement('div');
        const choices = item.review_status === 'PENDING'
          ? [['Mark reviewed', 'REVIEWED'], ['Record follow-up needed', 'FOLLOW_UP']]
          : item.review_status === 'REVIEWED'
            ? [['Record follow-up needed', 'FOLLOW_UP'], ['Close review', 'CLOSED']]
            : item.review_status === 'FOLLOW_UP'
              ? [['Complete follow-up', 'CLOSED']]
              : [];
        choices.forEach(function(choice) {
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'counselor-action-button';
          action.textContent = choice[0];
          action.addEventListener('click', function() {
            action.disabled = true;
            google.script.run.withSuccessHandler(function(response) {
              if (!response || !response.success) {
                action.disabled = false;
                alert((response && response.error) || 'Unable to save screening review.');
                return;
              }
              target.hidden = true;
              UI.loadCounselorScreenings(root, token, root.querySelector('[data-counselor-message]'));
            }).withFailureHandler(function(error) {
              action.disabled = false;
              alert(error && error.message ? error.message : 'Unable to save screening review.');
            }).processDASS21ScreeningReview(token, item.id, choice[1]);
          });
          actions.appendChild(action);
        });
        target.appendChild(actions);
        target.hidden = false;
      });
      return [
        UI.formatPortalDate(item.created_at),
        item.student ? item.student.student_number : 'Student identifier unavailable',
        item.subscales.depression.score + ' · ' + item.subscales.depression.severity,
        item.subscales.anxiety.score + ' · ' + item.subscales.anxiety.severity,
        item.subscales.stress.score + ' · ' + item.subscales.stress.severity,
        item.review_status,
        item.priority,
        button
      ];
    });
    UI.renderCounselorTable(container, ['Date', 'Student', 'Depression', 'Anxiety', 'Stress', 'Review status', 'Priority', 'Review'], rows);
    root.querySelector('[data-screening-limit]').textContent = result.data.length === result.limit
      ? 'Showing the latest ' + result.limit + ' records.'
      : '';
  },

  loadCounselorRisks: function(root, token, message) {
    const filter = root.querySelector('#risk-status-filter');
    const load = function() {
      google.script.run.withSuccessHandler(function(result) {
        if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load risk notifications.');
        message.hidden = true;
        UI.renderCounselorRisks(root, result.data || [], token, false);
      }).withFailureHandler(function(error) {
        UI.showCounselorError(message, error, 'Unable to load risk notifications.');
      }).getCounselorRiskFlags(token, filter.value || null);
    };
    if (!filter.dataset.bound) {
      filter.dataset.bound = 'true';
      filter.addEventListener('change', load);
    }
    load();
  },

  renderCounselorRisks: function(root, items, token, followupsOnly) {
    const container = root.querySelector(followupsOnly ? '[data-followup-list]' : '[data-risk-list]');
    container.replaceChildren();
    if (!items.length) return UI.appendPortalEmpty(container, followupsOnly ? 'No follow-up records are currently open.' : 'No risk notifications match this filter.');
    items.forEach(function(item) {
      if (followupsOnly && item.status !== 'FOLLOW_UP') return;
      const card = document.createElement('article');
      card.className = 'counselor-risk-card';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      const student = item.student;
      title.textContent = item.trigger_type + ' · ' + (student ? student.student_number : 'Student identifier unavailable');
      const status = document.createElement('p');
      status.textContent = 'Status: ' + item.status + ' · Priority: ' + (item.priority || item.severity);
      const created = document.createElement('p');
      created.textContent = 'Received: ' + UI.formatPortalDate(item.created_at);
      const trigger = document.createElement('p');
      trigger.textContent = item.trigger_value || 'Review the linked record for context.';
      info.append(title, status, created, trigger);
      const actions = document.createElement('div');
      const options = item.status === 'PENDING'
        ? [['Mark reviewed', 'REVIEWED'], ['Set follow-up', 'FOLLOW_UP'], ['Close', 'CLOSED']]
        : item.status === 'REVIEWED'
          ? [['Set follow-up', 'FOLLOW_UP'], ['Close', 'CLOSED']]
          : item.status === 'FOLLOW_UP'
            ? [['Complete follow-up', 'CLOSED']]
            : [];
      options.forEach(function(option) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'counselor-action-button';
        button.textContent = option[0];
        button.addEventListener('click', function() {
          button.disabled = true;
          if (item.assessment_id) {
            google.script.run.withSuccessHandler(function(result) {
              if (!result || !result.success) {
                button.disabled = false;
                alert((result && result.error) || 'Unable to update screening review.');
                return;
              }
              const route = document.body.dataset.pageKey;
              if (route === 'counselor-followups') UI.loadCounselorFollowups(root, token, root.querySelector('[data-counselor-message]'));
              else UI.loadCounselorRisks(root, token, root.querySelector('[data-counselor-message]'));
            }).withFailureHandler(function(error) {
              button.disabled = false;
              alert(error && error.message ? error.message : 'Unable to update screening review.');
            }).processDASS21ScreeningReview(token, item.assessment_id, option[1]);
          } else {
            google.script.run.withSuccessHandler(function(result) {
              if (!result || !result.success) {
                button.disabled = false;
                alert((result && result.error) || 'Unable to update notification.');
                return;
              }
              const route = document.body.dataset.pageKey;
              if (route === 'counselor-followups') UI.loadCounselorFollowups(root, token, root.querySelector('[data-counselor-message]'));
              else UI.loadCounselorRisks(root, token, root.querySelector('[data-counselor-message]'));
            }).withFailureHandler(function(error) {
              button.disabled = false;
              alert(error && error.message ? error.message : 'Unable to update notification.');
            }).processRiskFlagReview(token, item.id, option[1], item.status);
          }
        });
        actions.appendChild(button);
      });
      card.append(info, actions);
      container.appendChild(card);
    });
  },

  loadCounselorFollowups: function(root, token, message) {
    google.script.run.withSuccessHandler(function(result) {
      if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load follow-ups.');
      message.hidden = true;
      UI.renderCounselorRisks(root, (result.data || []).filter(function(item) { return item.status === 'FOLLOW_UP'; }), token, true);
    }).withFailureHandler(function(error) {
      UI.showCounselorError(message, error, 'Unable to load follow-ups.');
    }).getCounselorRiskFlags(token, 'FOLLOW_UP');
  },

  renderCounselorReports: function(root, result) {
    const labels = {
      dassSubmissionsLastSevenDays: 'DASS-21 submissions (last 7 days)',
      pendingScreeningReviews: 'Pending screening reviews',
      priorityScreeningReviews: 'Priority screening reviews',
      reviewedScreenings: 'Reviewed screenings',
      pendingResponses: 'AI responses awaiting review',
      completedResponses: 'Responses approved or edited',
      rejectedResponses: 'Responses rejected',
      pendingRisks: 'Pending risk notifications',
      followUps: 'Open follow-ups',
      completedFollowUps: 'Closed risk notifications'
    };
    const grid = root.querySelector('[data-report-metrics]');
    grid.replaceChildren();
    Object.keys(labels).forEach(function(key) {
      const card = document.createElement('article');
      card.className = 'counselor-metric-card';
      const label = document.createElement('p');
      label.textContent = labels[key];
      const count = document.createElement('strong');
      count.textContent = String(result.counts[key]);
      card.append(label, count);
      grid.appendChild(card);
    });
    const trend = root.querySelector('[data-weekly-screening-trend]');
    trend.replaceChildren();
    const maxCount = Math.max.apply(null, (result.weeklyScreeningTrend || []).map(function(item) { return item.count; }).concat([1]));
    (result.weeklyScreeningTrend || []).forEach(function(item) {
      const row = document.createElement('div');
      row.className = 'counselor-trend-row';
      const label = document.createElement('span');
      label.textContent = item.label;
      const bar = document.createElement('span');
      bar.className = 'counselor-trend-bar';
      bar.style.width = (item.count / maxCount * 100) + '%';
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', item.count + ' screenings');
      const count = document.createElement('strong');
      count.textContent = String(item.count);
      row.append(label, bar, count);
      trend.appendChild(row);
    });
    root.querySelector('[data-screening-trend-limit]').textContent = result.screeningTrendTruncated
      ? 'Trend is capped at the latest 5,000 records for this period.'
      : '';
    const history = (result.recentReviews || []).map(function(item) {
      return [
        UI.formatPortalDate(item.created_at),
        item.action,
        item.counselor_id,
        item.ai_response_id
      ];
    });
    UI.renderCounselorTable(
      root.querySelector('[data-recent-counselor-reviews]'),
      ['Date', 'Action', 'Counselor account ID', 'Review record ID'],
      history
    );
  },

  renderCounselorResources: function(root, items) {
    const container = root.querySelector('[data-counselor-resources-list]');
    container.replaceChildren();
    if (!items.length) return UI.appendPortalEmpty(container, 'No approved resources are published.');
    items.forEach(function(item) {
      const article = document.createElement('article');
      article.className = 'approved-resource';
      const heading = document.createElement('h3');
      heading.textContent = item.topic;
      const content = document.createElement('p');
      content.textContent = item.content;
      article.append(heading, content);
      container.appendChild(article);
    });
  },

  loadCounselorProfile: function(root, token, message) {
    google.script.run.withSuccessHandler(function(result) {
      if (!result || !result.success) return UI.showPortalError(message, (result && result.error) || 'Unable to load counselor profile.');
      message.hidden = true;
      const container = root.querySelector('[data-counselor-profile-fields]');
      container.replaceChildren();
      [
        ['Name', result.profile.full_name],
        ['Institutional email', result.profile.email],
        ['Role', result.profile.role],
        ['Account status', result.profile.status],
        ['Account created', UI.formatPortalDate(result.profile.created_at)]
      ].forEach(function(pair) {
        const term = document.createElement('dt');
        term.textContent = pair[0];
        const value = document.createElement('dd');
        value.textContent = pair[1] || 'Not recorded';
        container.append(term, value);
      });
    }).withFailureHandler(function(error) {
      UI.showCounselorError(message, error, 'Unable to load counselor profile.');
    }).getCounselorProfile(token);
  },

  renderStudentPortal: function(section, data) {
    if (section === 'dashboard') UI.renderStudentDashboard(data);
    if (section === 'screening') UI.renderStudentScreening(data);
    if (section === 'progress') UI.renderStudentProgress(data);
    if (section === 'resources') UI.renderStudentResources(data);
    if (section === 'profile') UI.renderStudentProfile(data);
  },

  formatPortalDate: function(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  },

  renderStudentDashboard: function(data) {
    const assessments = data.assessments || [];
    const weekStatus = document.querySelector('[data-week-status]');
    const weekDetail = document.querySelector('[data-week-detail]');
    if (weekStatus) weekStatus.textContent = data.thisWeekCount ? 'A screening was completed in the last 7 days' : 'No screening in the last 7 days';
    if (weekDetail) {
      weekDetail.textContent = 'This status reflects DASS-21 records saved in the rolling 7-day period. ' +
        (data.thisWeekCount ? data.thisWeekCount + ' record(s) found.' : 'If approved consent and review policy are configured, you can complete a screening.');
    }

    const latestContainer = document.querySelector('[data-latest-screening]');
    if (latestContainer) {
      latestContainer.replaceChildren();
      if (!assessments.length) {
        const empty = document.createElement('p');
        empty.className = 'portal-empty-state';
        empty.textContent = 'No prior screening participation is recorded. Open Weekly Screening to check whether submission is currently enabled.';
        latestContainer.appendChild(empty);
      } else {
        const latest = assessments[0];
        const summary = document.createElement('p');
        summary.textContent = UI.formatPortalDate(latest.created_at) + ' · ' + latest.type;
        const disclaimer = document.createElement('p');
        disclaimer.className = 'portal-muted';
        disclaimer.textContent = 'Participation date only; screening scores and review details are not shown here.';
        latestContainer.append(summary, disclaimer);
      }
    }

    const activity = document.querySelector('[data-activity-summary]');
    if (activity) {
      activity.replaceChildren();
      const count = document.createElement('p');
      count.textContent = 'Completed records in the latest ' + data.assessmentLimit + ' shown: ' + assessments.length;
      activity.appendChild(count);
      if (assessments.length) {
        const lastDate = document.createElement('p');
        lastDate.textContent = 'Most recent activity: ' + UI.formatPortalDate(assessments[0].created_at);
        activity.appendChild(lastDate);
      } else {
        const empty = document.createElement('p');
        empty.className = 'portal-empty-state';
        empty.textContent = 'Your participation history will appear here after a screening is saved.';
        activity.appendChild(empty);
      }
    }
  },

  renderStudentScreening: function(data) {
    const root = document.getElementById('student-screening');
    const form = root.querySelector('[data-dass-form]');
    const gate = root.querySelector('[data-dass-gate]');
    const questionsContainer = root.querySelector('[data-dass-questions]');
    const choices = [
      'Did not apply to me at all',
      'Applied to me to some degree, or some of the time',
      'Applied to me to a considerable degree, or a good part of the time',
      'Applied to me very much, or most of the time'
    ];
    const questions = [
      'I found it hard to wind down.',
      'I was aware of dryness of my mouth.',
      "I couldn't seem to experience any positive feeling at all.",
      'I experienced breathing difficulty (e.g., excessively rapid breathing, breathlessness in the absence of physical exertion).',
      'I found it difficult to work up the initiative to do things.',
      'I tended to over-react to situations.',
      'I experienced trembling (e.g., in the hands).',
      'I felt that I was using a lot of nervous energy.',
      'I was worried about situations in which I might panic and make a fool of myself.',
      'I felt that I had nothing to look forward to.',
      'I found myself getting agitated.',
      'I found it difficult to relax.',
      'I felt down-hearted and blue.',
      'I was intolerant of anything that kept me from getting on with what I was doing.',
      'I felt I was close to panic.',
      'I was unable to become enthusiastic about anything.',
      "I felt I wasn't worth much as a person.",
      'I felt that I was rather touchy.',
      'I was aware of the action of my heart in the absence of physical exertion (e.g., sense of heart rate increase, heart missing a beat).',
      'I felt scared without any good reason.',
      'I felt that life was meaningless.'
    ];
    questionsContainer.replaceChildren();
    questions.forEach(function(question, index) {
      const number = index + 1;
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'dass-question';
      const legend = document.createElement('legend');
      legend.textContent = number + '. ' + question;
      fieldset.appendChild(legend);
      const options = document.createElement('div');
      options.className = 'dass-option-grid';
      choices.forEach(function(label, score) {
        const optionLabel = document.createElement('label');
        optionLabel.className = 'dass-option';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'dass-item-' + number;
        radio.value = String(score);
        radio.required = true;
        radio.disabled = true;
        radio.addEventListener('change', UI.updateDASSProgress);
        const caption = document.createElement('span');
        caption.textContent = score + ' — ' + label;
        optionLabel.append(radio, caption);
        options.appendChild(optionLabel);
      });
      fieldset.appendChild(options);
      questionsContainer.appendChild(fieldset);
    });

    const historyContainer = root.querySelector('[data-dass-history]');
    historyContainer.replaceChildren();
    const history = data.assessments || [];
    if (!history.length) {
      UI.appendPortalEmpty(historyContainer, 'No previous DASS-21 participation is recorded.');
    } else {
      const list = document.createElement('ul');
      list.className = 'dass-participation-list';
      history.filter(function(item) { return item.type === 'DASS21'; }).forEach(function(item) {
        const entry = document.createElement('li');
        entry.textContent = UI.formatPortalDate(item.created_at) + ' · Completed';
        list.appendChild(entry);
      });
      if (!list.children.length) UI.appendPortalEmpty(historyContainer, 'No previous DASS-21 participation is recorded.');
      else historyContainer.appendChild(list);
    }

    const weekDetail = document.querySelector('[data-week-detail]');
    if (weekDetail) {
      weekDetail.textContent = data.thisWeekCount
        ? 'A DASS-21 screening was saved within the last seven days. Another submission is not available yet.'
        : 'One screening may be submitted per rolling seven-day period, once the required consent and review approvals are configured.';
    }
    if (!form.dataset.eventsBound) {
      form.dataset.eventsBound = 'true';
      root.querySelector('[data-dass-review-button]').addEventListener('click', UI.reviewDASSAnswers);
      root.querySelector('[data-dass-edit]').addEventListener('click', function() {
        root.querySelector('[data-dass-review]').hidden = true;
        root.querySelector('[data-dass-questions]').hidden = false;
        root.querySelector('[data-dass-submit-row]').hidden = false;
      });
      root.querySelector('[data-dass-confirm]').addEventListener('click', UI.submitDASSAnswers);
    }
    google.script.run.withSuccessHandler(function(config) {
      if (!config || !config.success) {
        gate.textContent = (config && config.error) || 'Unable to load screening settings.';
        gate.hidden = false;
        form.querySelectorAll('input, button').forEach(function(control) { control.disabled = true; });
        return;
      }
      if (config.consentText) {
        root.querySelector('[data-dass-consent-text]').textContent = config.consentText;
        root.querySelector('[data-dass-consent-row]').hidden = false;
      }
      const alreadySubmitted = data.thisWeekCount > 0;
      const canSubmit = config.submissionEnabled && !alreadySubmitted;
      if (!canSubmit) {
        gate.textContent = alreadySubmitted
          ? 'A DASS-21 screening was submitted within the last seven days. New responses are disabled until the rolling period ends.'
          : config.message || 'Screening submission is not enabled.';
        gate.hidden = false;
      }
      form.querySelectorAll('input[type="radio"]').forEach(function(control) {
        control.disabled = !canSubmit;
      });
      form.dataset.submissionEnabled = String(canSubmit);
      const consentControl = root.querySelector('[data-dass-consent]');
      if (!consentControl.dataset.bound) {
        consentControl.dataset.bound = 'true';
        consentControl.addEventListener('change', UI.updateDASSProgress);
      }
      UI.updateDASSProgress();
    }).withFailureHandler(function(error) {
      gate.textContent = error && error.message ? error.message : 'Unable to load screening settings.';
      gate.hidden = false;
      form.querySelectorAll('input, button').forEach(function(control) { control.disabled = true; });
    }).getDASS21ScreeningConfig(sessionStorage.getItem('mindbridge_session_token'));
  },

  renderStudentProgress: function(data) {
    const history = data.assessments || [];
    const chart = document.querySelector('[data-progress-chart]');
    if (chart) chart.remove();

    const list = document.querySelector('[data-assessment-history]');
    if (list) {
      list.replaceChildren();
      if (!history.length) {
        const empty = document.createElement('p');
        empty.className = 'portal-empty-state';
        empty.textContent = 'No completed screening records are available for your account.';
        list.appendChild(empty);
      } else {
        const table = document.createElement('table');
        table.className = 'portal-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Date', 'Screening', 'Participation'].forEach(function(label) {
          const th = document.createElement('th');
          th.scope = 'col';
          th.textContent = label;
          headRow.appendChild(th);
        });
        head.appendChild(headRow);
        const body = document.createElement('tbody');
        history.forEach(function(item) {
          const row = document.createElement('tr');
          [UI.formatPortalDate(item.created_at), item.type, 'Completed'].forEach(function(value) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          });
          body.appendChild(row);
        });
        table.append(head, body);
        list.appendChild(table);
      }
    }
    const limit = document.querySelector('[data-history-limit]');
    if (limit) limit.textContent = history.length === data.assessmentLimit ? 'Showing the latest ' + data.assessmentLimit + ' records.' : '';
  },

  updateDASSProgress: function() {
    const root = document.getElementById('student-screening');
    if (!root) return;
    const answered = root.querySelectorAll('[data-dass-questions] input[type="radio"]:checked').length;
    const count = root.querySelector('[data-dass-progress-text]');
    const progress = root.querySelector('[data-dass-progress-bar]');
    const reviewButton = root.querySelector('[data-dass-review-button]');
    if (count) count.textContent = answered + ' of 21 answered';
    if (progress) progress.value = answered;
    const consent = root.querySelector('[data-dass-consent]');
    const consentRequired = !root.querySelector('[data-dass-consent-row]').hidden;
    const hasConsent = !consentRequired || Boolean(consent && consent.checked);
    if (reviewButton) {
      reviewButton.disabled = root.querySelector('[data-dass-form]').dataset.submissionEnabled !== 'true' ||
        answered !== 21 || !hasConsent;
    }
  },

  reviewDASSAnswers: function() {
    const root = document.getElementById('student-screening');
    const form = root.querySelector('[data-dass-form]');
    if (!form.reportValidity()) return;
    if (form.dataset.submissionEnabled !== 'true') return;
    const consent = root.querySelector('[data-dass-consent]');
    const consentRequired = !root.querySelector('[data-dass-consent-row]').hidden;
    if (consentRequired && !consent.checked) {
      const gate = root.querySelector('[data-dass-gate]');
      gate.textContent = 'Please read and accept the institution-approved screening information before continuing.';
      gate.hidden = false;
      return;
    }
    const list = root.querySelector('[data-dass-review-list]');
    list.replaceChildren();
    root.querySelectorAll('[data-dass-questions] .dass-question').forEach(function(fieldset) {
      const selected = fieldset.querySelector('input:checked');
      const entry = document.createElement('li');
      entry.textContent = fieldset.querySelector('legend').textContent + ' — ' +
        (selected ? selected.value + ': ' + selected.parentNode.querySelector('span').textContent.replace(/^\d+ — /, '') : 'not answered');
      list.appendChild(entry);
    });
    root.querySelector('[data-dass-questions]').hidden = true;
    root.querySelector('[data-dass-submit-row]').hidden = true;
    root.querySelector('[data-dass-review]').hidden = false;
  },

  submitDASSAnswers: function() {
    const root = document.getElementById('student-screening');
    const form = root.querySelector('[data-dass-form]');
    const confirmButton = root.querySelector('[data-dass-confirm]');
    if (!window.confirm('Submit your DASS-21 responses now? You will not be able to submit another screening for seven days.')) return;
    const answers = {};
    for (let question = 1; question <= 21; question++) {
      const selected = form.querySelector('input[name="dass-item-' + question + '"]:checked');
      if (!selected) {
        root.querySelector('[data-dass-review]').hidden = true;
        root.querySelector('[data-dass-questions]').hidden = false;
        root.querySelector('[data-dass-submit-row]').hidden = false;
        return;
      }
      answers[String(question)] = Number(selected.value);
    }
    const consent = root.querySelector('[data-dass-consent]');
    confirmButton.disabled = true;
    confirmButton.textContent = 'Saving…';
    google.script.run.withSuccessHandler(function(result) {
      confirmButton.textContent = 'Confirm and submit';
      if (!result || !result.success) {
        confirmButton.disabled = false;
        const gate = root.querySelector('[data-dass-gate]');
        gate.textContent = (result && result.error) || 'Unable to save your screening.';
        gate.hidden = false;
        return;
      }
      root.querySelector('[data-dass-review]').hidden = true;
      root.querySelector('[data-dass-questions]').hidden = true;
      root.querySelector('[data-dass-submit-row]').hidden = true;
      const resultNotice = root.querySelector('[data-dass-result]');
      resultNotice.className = result.notificationCreated === false
        ? 'portal-message portal-message-error'
        : 'portal-message portal-message-success';
      resultNotice.textContent = result.message ||
        'Your screening was saved. Participation is visible in your progress history.';
      resultNotice.hidden = false;
      UI.loadStudentPortal('screening');
    }).withFailureHandler(function(error) {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Confirm and submit';
      const gate = root.querySelector('[data-dass-gate]');
      gate.textContent = error && error.message ? error.message : 'Unable to save your screening. Please try again.';
      gate.hidden = false;
    }).submitStudentDASS21(
      sessionStorage.getItem('mindbridge_session_token'),
      answers,
      Boolean(consent && (!root.querySelector('[data-dass-consent-row]').hidden ? consent.checked : false))
    );
  },

  createAssessmentChart: function(type, records) {
    const section = document.createElement('section');
    section.className = 'portal-chart-section';
    const heading = document.createElement('h3');
    heading.textContent = type;
    section.appendChild(heading);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 700 220');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', type + ' recorded scores by date');
    const scores = records.map(function(item) { return Number(item.total_score) || 0; });
    const max = Math.max.apply(null, scores.concat([1]));
    const xStart = 48;
    const xEnd = 670;
    const yTop = 24;
    const yBottom = 166;
    const points = records.map(function(item, index) {
      const x = records.length === 1 ? xStart : xStart + (xEnd - xStart) * index / (records.length - 1);
      const y = yBottom - (Number(item.total_score) || 0) / max * (yBottom - yTop);
      return { x: x, y: y, score: item.total_score, date: UI.formatPortalDate(item.created_at) };
    });
    const axis = document.createElementNS(svg.namespaceURI, 'line');
    axis.setAttribute('x1', String(xStart));
    axis.setAttribute('x2', String(xEnd));
    axis.setAttribute('y1', String(yBottom));
    axis.setAttribute('y2', String(yBottom));
    axis.setAttribute('class', 'portal-chart-axis');
    svg.appendChild(axis);
    const polyline = document.createElementNS(svg.namespaceURI, 'polyline');
    polyline.setAttribute('points', points.map(function(point) { return point.x + ',' + point.y; }).join(' '));
    polyline.setAttribute('class', 'portal-chart-line');
    svg.appendChild(polyline);
    points.forEach(function(point, index) {
      const circle = document.createElementNS(svg.namespaceURI, 'circle');
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', '5');
      circle.setAttribute('class', 'portal-chart-point');
      const title = document.createElementNS(svg.namespaceURI, 'title');
      title.textContent = point.date + ': ' + point.score;
      circle.appendChild(title);
      svg.appendChild(circle);
      if (index === 0 || index === points.length - 1) {
        const label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', String(point.x));
        label.setAttribute('y', '196');
        label.setAttribute('text-anchor', index === 0 ? 'start' : 'end');
        label.setAttribute('class', 'portal-chart-label');
        label.textContent = point.date;
        svg.appendChild(label);
      }
    });
    section.appendChild(svg);
    return section;
  },

  renderStudentResources: function(data) {
    const container = document.querySelector('[data-approved-resources]');
    if (container) {
      container.replaceChildren();
      const resources = data.resources || [];
      if (!resources.length) {
        const empty = document.createElement('p');
        empty.className = 'portal-empty-state';
        empty.textContent = 'No counselor-approved wellness resources have been published yet. Contact the Guidance Office for support.';
        container.appendChild(empty);
        ['Stress management', 'Healthy coping strategies', 'Academic stress support', 'Self-care guidance']
          .forEach(function(topic) {
            const placeholder = document.createElement('article');
            placeholder.className = 'approved-resource';
            const heading = document.createElement('h3');
            heading.textContent = topic;
            const status = document.createElement('p');
            status.className = 'portal-muted';
            status.textContent = 'Counselor-approved guidance for this topic has not been published yet.';
            placeholder.append(heading, status);
            container.appendChild(placeholder);
          });
      }
      resources.forEach(function(resource) {
        const article = document.createElement('article');
        article.className = 'approved-resource';
        const heading = document.createElement('h3');
        heading.textContent = resource.topic || 'Wellness resource';
        const content = document.createElement('p');
        content.textContent = resource.content || '';
        article.append(heading, content);
        container.appendChild(article);
      });
    }

    const contacts = document.querySelector('[data-crisis-contacts]');
    if (contacts && data.crisisResources) {
      contacts.replaceChildren();
      Object.keys(data.crisisResources).forEach(function(key) {
        const item = document.createElement('p');
        item.textContent = data.crisisResources[key];
        contacts.appendChild(item);
      });
    }
  },

  renderStudentProfile: function(data) {
    const container = document.querySelector('[data-profile-fields]');
    if (!container) return;
    container.replaceChildren();
    [
      ['Name', data.profile.name],
      ['Institutional email', data.profile.email],
      ['Student identifier', data.profile.studentNumber],
      ['Course / program', data.profile.course],
      ['Year level', data.profile.yearLevel],
      ['Role', data.profile.role]
    ].forEach(function(field) {
      const term = document.createElement('dt');
      term.textContent = field[0];
      const description = document.createElement('dd');
      description.textContent = field[1] === null || field[1] === undefined || field[1] === ''
        ? 'Not recorded'
        : String(field[1]);
      container.append(term, description);
    });
  }
};