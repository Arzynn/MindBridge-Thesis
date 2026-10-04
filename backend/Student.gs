function registerStudent(formData) {
  try {
    var data = formData || {};
    var requiredFields = ['email', 'password', 'studentNumber', 'firstName', 'lastName', 'course', 'yearLevel'];
    for (var index = 0; index < requiredFields.length; index++) {
      var field = requiredFields[index];
      if (!data[field] || String(data[field]).trim() === '') return { success: false, error: 'Please provide all required registration fields.' };
    }
    var email = String(data.email).trim().toLowerCase();
    var password = String(data.password);
    var studentNumber = String(data.studentNumber).trim();
    var yearLevel = Number(data.yearLevel);
    if (!/^[^\s@]+@[^\s@]+\.edu(?:\.[a-z]{2})?$/i.test(email)) return { success: false, error: 'Please provide a valid institutional email address.' };
    if (password.length < 8 || password.length > 128) return { success: false, error: 'Password must be between 8 and 128 characters long.' };
    if (email.length > 254 || studentNumber.length > 50 ||
        String(data.firstName).trim().length > 100 ||
        String(data.lastName).trim().length > 100 ||
        String(data.course).trim().length > 255) {
      return { success: false, error: 'One or more registration fields exceed the allowed length.' };
    }
    if (!isFinite(yearLevel) || yearLevel < 1 || yearLevel > 6 || Math.floor(yearLevel) !== yearLevel) return { success: false, error: 'Please provide a valid year level.' };
    var emailCheck = Database.select('users', 'select=id&email=eq.' + encodeURIComponent(email));
    if (!emailCheck.success) return { success: false, error: 'Unable to check the email address right now.' };
    if (emailCheck.data && emailCheck.data.length > 0) return { success: false, error: 'An account with this email already exists.' };
    var studentNumberCheck = Database.select('student_profiles', 'select=id&student_number=eq.' + encodeURIComponent(studentNumber));
    if (!studentNumberCheck.success) return { success: false, error: 'Unable to check the student number right now.' };
    if (studentNumberCheck.data && studentNumberCheck.data.length > 0) return { success: false, error: 'An account with this student number already exists.' };
    var userResult = Database.insert('users', { email: email, password_hash: hashStudentPassword_(password), role: 'STUDENT', status: 'ACTIVE' });
    if (!userResult.success || !userResult.data || userResult.data.length === 0) return { success: false, error: 'Unable to create the account.' };
    var userId = userResult.data[0].id;
    var profileResult = Database.insert('student_profiles', { user_id: userId, student_number: studentNumber, first_name: String(data.firstName).trim(), last_name: String(data.lastName).trim(), course: String(data.course).trim(), year_level: yearLevel });
    if (!profileResult.success) return { success: false, error: 'The account was created, but the student profile could not be saved.' };
    Database.insert('audit_logs', { user_id: userId, action: 'USER_REGISTERED', entity_type: 'users', entity_id: userId, details: { role: 'STUDENT' } }, { id: userId, role: 'ADMIN' });
    return { success: true, message: 'Account created successfully!' };
  } catch (error) {
    Logger.log('Student registration exception: ' + error.toString());
    return { success: false, error: 'Registration failed. Please try again.' };
  }
}

function hashStudentPassword_(password) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  var hash = digest.map(function(byte) { var value = byte < 0 ? byte + 256 : byte; return ('0' + value.toString(16)).slice(-2); }).join('');
  return 'sha256$' + salt + '$' + hash;
}