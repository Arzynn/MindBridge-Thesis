var Database = (function() {
  function getHeaders(contextUser) {
    var supabaseKey = getRequiredScriptProperty_('SUPABASE_SERVICE_ROLE_KEY');
    var headers = {
      "apikey": supabaseKey,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };
    if (supabaseKey.indexOf('sb_secret_') !== 0) {
      headers["Authorization"] = "Bearer " + supabaseKey;
    }
    if (contextUser) {
      headers["app.current_user_id"] = contextUser.id;
      headers["app.current_user_role"] = contextUser.role;
    }
    return headers;
  }

  function parseResponseText(text) {
    if (!text || String(text).trim() === '') {
      return [];
    }

    var trimmed = String(text).trim();
    if (trimmed === 'null' || trimmed === 'undefined') {
      return [];
    }

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      Logger.log('Database response was not valid JSON.');
      return trimmed;
    }
  }

  function query(endpoint, options, contextUser) {
    var url = getRequiredScriptProperty_('SUPABASE_URL') + "/rest/v1/" + endpoint;
    var fetchOptions = {
      method: options.method || 'GET',
      headers: getHeaders(contextUser),
      muteHttpExceptions: true
    };

    if (options.payload) {
      fetchOptions.payload = JSON.stringify(options.payload);
    }

    try {
      var response = UrlFetchApp.fetch(url, fetchOptions);
      var code = response.getResponseCode();
      var text = response.getContentText();
      var trimmedText = text ? String(text).trim() : '';

      if (code >= 200 && code < 300) {
        return { success: true, data: parseResponseText(trimmedText) };
      }

      Logger.log('Database request failed with HTTP status ' + code + '.');
      return { success: false, error: 'Database request failed.', status: code };
    } catch (e) {
      Logger.log('Database connection failed.');
      return { success: false, error: 'Database connection failed.' };
    }
  }

  function checkConnection() {
    var response;
    try {
      response = UrlFetchApp.fetch(
        getRequiredScriptProperty_('SUPABASE_URL') + '/rest/v1/users?select=id&limit=0',
        {
          method: 'GET',
          headers: getHeaders(),
          muteHttpExceptions: true
        }
      );
    } catch (error) {
      Logger.log('Supabase connection check request failed.');
      return {
        success: false,
        status: null,
        code: null,
        error: 'Could not reach the Supabase REST API. Check the project URL and Apps Script external-request authorization.'
      };
    }

    var status = response.getResponseCode();
    if (status >= 200 && status < 300) {
      return { success: true, status: status, code: null, error: null };
    }

    var code = null;
    var message = 'Supabase rejected the request.';
    try {
      var responseBody = JSON.parse(response.getContentText() || '{}');
      code = responseBody.code ? String(responseBody.code).slice(0, 40) : null;
      if (responseBody.message) {
        message = String(responseBody.message)
          .replace(/https?:\/\/\S+/gi, '[URL]')
          .replace(/(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+/g, '[REDACTED]')
          .slice(0, 240);
      }
    } catch (error) {
      message = 'Supabase returned an unreadable error response.';
    }

    return { success: false, status: status, code: code, error: message };
  }

  function countRows(table, filterQuery, contextUser) {
    var endpoint = table + '?select=id' + (filterQuery ? '&' + filterQuery : '') + '&limit=1';
    var response;
    try {
      response = UrlFetchApp.fetch(
        getRequiredScriptProperty_('SUPABASE_URL') + '/rest/v1/' + endpoint,
        {
          method: 'GET',
          headers: Object.assign({}, getHeaders(contextUser), {
            'Prefer': 'count=exact',
            'Range': '0-0'
          }),
          muteHttpExceptions: true
        }
      );
    } catch (error) {
      Logger.log('Database count request failed.');
      return { success: false, error: 'Database connection failed.' };
    }

    var status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      Logger.log('Database count request failed with HTTP status ' + status + '.');
      return { success: false, error: 'Database request failed.', status: status };
    }

    var headers = response.getAllHeaders();
    var contentRange = '';
    Object.keys(headers).some(function(key) {
      if (key.toLowerCase() === 'content-range') {
        contentRange = String(headers[key]);
        return true;
      }
      return false;
    });
    var match = contentRange.match(/\/(\d+|\*)$/);
    if (!match || match[1] === '*') {
      return { success: false, error: 'Database did not return an exact record count.' };
    }
    return { success: true, count: Number(match[1]) };
  }

  return {
    select: function(table, filterQuery, contextUser) {
      var endpoint = table + (filterQuery ? "?" + filterQuery : "");
      return query(endpoint, { method: 'GET' }, contextUser);
    },
    insert: function(table, payload, contextUser) {
      return query(table, { method: 'POST', payload: payload }, contextUser);
    },
    update: function(table, filterQuery, payload, contextUser) {
      var endpoint = table + "?" + filterQuery;
      return query(endpoint, { method: 'PATCH', payload: payload }, contextUser);
    },
    delete: function(table, filterQuery, contextUser) {
      var endpoint = table + "?" + filterQuery;
      return query(endpoint, { method: 'DELETE' }, contextUser);
    },
    countRows: countRows,
    checkConnection: checkConnection
  };
})();