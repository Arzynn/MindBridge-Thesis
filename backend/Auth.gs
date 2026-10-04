function hashPasswordValue_(password, salt) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + String(password || ''),
    Utilities.Charset.UTF_8
  );

  var hash = digest.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');

  return hash;
}

function verifyPassword_(inputPassword, storedHash) {
  if (!inputPassword || !storedHash) {
    return false;
  }

  if (String(storedHash) === String(inputPassword)) {
    return true;
  }

  if (String(storedHash).indexOf('sha256$') === 0) {
    var parts = String(storedHash).split('$');
    if (parts.length === 3) {
      var salt = parts[1];
      var expectedHash = parts[2];
      var actualHash = hashPasswordValue_(String(inputPassword), salt);
      return actualHash === expectedHash;
    }
  }

  return false;
}

function loginUser(email, password, expectedRole) {
  try {
    var normalizedEmail = String(email || '').trim().toLowerCase();
    var requestedRole = expectedRole ? String(expectedRole).toUpperCase() : '';

    if (!normalizedEmail || !password || ['STUDENT', 'COUNSELOR'].indexOf(requestedRole) === -1) {
      return { success: false, error: 'Invalid credentials' };
    }

    var userResult = Database.select('users', 'email=eq.' + encodeURIComponent(normalizedEmail) + '&select=*');
    if (!userResult.success) {
      return { success: false, error: 'Unable to sign in right now.' };
    }
    if (!userResult.data || userResult.data.length === 0) {
      return { success: false, error: 'Invalid credentials' };
    }

    var user = userResult.data[0];
    var userRole = String(user.role || '').toUpperCase();
    var userStatus = String(user.status || '').toUpperCase();

    if (userStatus !== 'ACTIVE') {
      return { success: false, error: 'Your account is inactive.' };
    }

    if (requestedRole && userRole !== requestedRole) {
      return { success: false, error: 'Invalid credentials' };
    }

    if (!verifyPassword_(String(password), String(user.password_hash || ''))) {
      return { success: false, error: 'Invalid credentials' };
    }

    var profileId = null;
    var name = user.full_name || user.name || normalizedEmail;

    if (userRole === 'STUDENT') {
      var profileResult = Database.select('student_profiles', 'user_id=eq.' + user.id + '&select=*');
      if (!profileResult.success) {
        return { success: false, error: 'Unable to sign in right now.' };
      }
      if (!profileResult.data || profileResult.data.length === 0) {
        return { success: false, error: 'Student profile not found.' };
      }

      var profile = profileResult.data[0];
      profileId = profile.id;
      name = [profile.first_name, profile.last_name].filter(function(item) {
        return item && String(item).trim() !== '';
      }).join(' ') || name;
    }

    var sessionPayload = {
      id: user.id,
      email: normalizedEmail,
      role: userRole,
      profileId: profileId,
      name: name
    };

    var sessionToken = Utilities.getUuid();
    var cache = CacheService.getScriptCache();
    cache.put('mindbridge_session_' + sessionToken, JSON.stringify(sessionPayload), 3600);

    return {
      success: true,
      user: sessionPayload,
      sessionToken: sessionToken
    };
  } catch (error) {
    Logger.log('Auth Login Exception: ' + error.toString());
    return { success: false, error: 'Unable to sign in right now.' };
  }
}

function getAuthenticatedUser_(sessionToken, expectedRole) {
  if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length > 128) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  var serializedUser = CacheService.getScriptCache().get('mindbridge_session_' + sessionToken);
  if (!serializedUser) {
    throw new Error('Your session has expired. Please sign in again.');
  }

  var user;
  try {
    user = JSON.parse(serializedUser);
  } catch (error) {
    CacheService.getScriptCache().remove('mindbridge_session_' + sessionToken);
    throw new Error('Your session is invalid. Please sign in again.');
  }

  if (!user || !user.id || !user.role || (expectedRole && user.role !== expectedRole)) {
    throw new Error('You are not authorized to perform this action.');
  }
  return user;
}

function logoutUser(sessionToken) {
  if (sessionToken && typeof sessionToken === 'string' && sessionToken.length <= 128) {
    CacheService.getScriptCache().remove('mindbridge_session_' + sessionToken);
  }
  return { success: true };
}
