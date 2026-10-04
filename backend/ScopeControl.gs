var ScopeControl = (function() {
  var OUT_OF_SCOPE_PATTERNS = [
    /\b(math|algebra|calculus|equation|solve)\b/i,
    /\b(programming|code|java|python|c\+\+|html|bug|fix code)\b/i,
    /\b(history|geography|capital of|who won|nba|football|score)\b/i,
    /\b(recipe|cook|movie review|weather forecast)\b/i
  ];

  return {
    isWithinScope: function(userMessage) {
      if (!userMessage || userMessage.trim().length === 0) return false;
      for (var i = 0; i < OUT_OF_SCOPE_PATTERNS.length; i++) {
        if (OUT_OF_SCOPE_PATTERNS[i].test(userMessage)) {
          return false;
        }
      }
      return true;
    },
    getFallbackResponse: function() {
      return CONFIG.OUT_OF_SCOPE_FALLBACK;
    }
  };
})();