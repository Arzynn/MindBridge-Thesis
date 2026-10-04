var GuidanceRetrieval = (function() {
  return {
    getRelevantGuidance: function(userMessage, userContext) {
      var res = Database.select('approved_guidance', 'status=eq.APPROVED', userContext);
      if (!res.success || !res.data || res.data.length === 0) {
        return "";
      }

      var tokens = userMessage.toLowerCase().replace(/[^\w\s]/gi, '').split(/\s+/);
      var matchedContent = [];

      for (var i = 0; i < res.data.length; i++) {
        var item = res.data[i];
        var keywords = item.keywords || [];
        var matchCount = 0;

        for (var k = 0; k < keywords.length; k++) {
          var kw = keywords[k].toLowerCase();
          for (var t = 0; t < tokens.length; t++) {
            if (tokens[t] === kw || kw.indexOf(tokens[t]) !== -1) {
              matchCount++;
            }
          }
        }

        if (matchCount > 0) {
          matchedContent.push({
            topic: item.topic,
            content: item.content,
            score: matchCount
          });
        }
      }

      matchedContent.sort(function(a, b) { return b.score - a.score; });

      var contextBlocks = [];
      var limit = Math.min(matchedContent.length, 2);
      for (var j = 0; j < limit; j++) {
        contextBlocks.push("Topic: " + matchedContent[j].topic + "\nContent: " + matchedContent[j].content);
      }

      return contextBlocks.join("\n---\n");
    }
  };
})();