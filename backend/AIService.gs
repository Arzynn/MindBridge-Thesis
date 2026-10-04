var AIService = (function() {
  function buildSystemPrompt(approvedContext) {
    return "You are the MindBridge AI Assistant, an supportive tool assisting university counselors.\n" +
           "ROLE & LIMITS:\n" +
           "- You provide empathetic, supportive, non-diagnostic student mental wellness guidance.\n" +
           "- You ARE NOT a therapist, psychologist, psychiatrist, or emergency service.\n" +
           "- DO NOT diagnose conditions, recommend medications, or promise clinical outcomes.\n" +
           "- DO NOT answer questions unrelated to mental wellness.\n\n" +
           "APPROVED GUIDANCE CONTEXT:\n" +
           (approvedContext ? approvedContext : "No specific guidance context available. Rely on standard non-clinical supportive communication.") + "\n\n" +
           "INSTRUCTIONS:\n" +
           "Formulate a supportive, brief, helpful draft response based STRICTLY on the approved context where applicable. " +
           "Your draft will be reviewed by a human guidance counselor before the student sees it.";
  }

  return {
    generateDraft: function(studentMessage, guidanceContext) {
      var systemPrompt = buildSystemPrompt(guidanceContext);
      var apiKey;
      try {
        apiKey = getRequiredScriptProperty_('GEMINI_API_KEY');
      } catch (error) {
        Logger.log('AI request was not sent because API configuration is missing.');
        return { success: false, code: 'MISSING_CONFIGURATION', error: 'AI service is not configured.' };
      }
      var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + CONFIG.AI_MODEL + ":generateContent";

      var payload = {
        "contents": [
          {
            "role": "user",
            "parts": [
              { "text": systemPrompt + "\n\nStudent Message: \"" + studentMessage + "\"" }
            ]
          }
        ],
        "generationConfig": {
          "maxOutputTokens": CONFIG.MAX_OUTPUT_TOKENS,
          "temperature": 0.3
        }
      };

      var options = {
        "method": "POST",
        "contentType": "application/json",
        "headers": { "x-goog-api-key": apiKey },
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      };

      try {
        var response = UrlFetchApp.fetch(endpoint, options);
        var status = response.getResponseCode();
        var json;
        try {
          json = JSON.parse(response.getContentText() || '{}');
        } catch (parseError) {
          Logger.log('AI response could not be parsed; HTTP status ' + status + '.');
          return { success: false, code: 'INVALID_RESPONSE', error: 'AI service returned an unreadable response.' };
        }

        if (status === 200 && json.candidates && json.candidates.length > 0 &&
            json.candidates[0].content && json.candidates[0].content.parts &&
            json.candidates[0].content.parts.length &&
            typeof json.candidates[0].content.parts[0].text === 'string' &&
            json.candidates[0].content.parts[0].text.trim()) {
          return { success: true, draft: json.candidates[0].content.parts[0].text.trim(), model: CONFIG.AI_MODEL };
        }
        Logger.log('AI generation did not return a usable draft; HTTP status ' + status + '.');
        return {
          success: false,
          code: status === 200 ? 'EMPTY_GENERATION' : 'HTTP_STATUS_' + status,
          error: status === 200 ? 'AI service returned no usable draft.' : 'AI API returned an error status.'
        };
      } catch (e) {
        Logger.log("AI service request failed.");
        return { success: false, code: 'REQUEST_FAILURE', error: "AI service is temporarily unavailable." };
      }
    }
  };
})();