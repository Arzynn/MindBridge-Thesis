var AuditLog = (function() {
  return {
    record: function(userId, action, entityType, entityId, detailsObj) {
      var payload = {
        user_id: userId || null,
        action: action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        details: detailsObj || {}
      };
      Database.insert('audit_logs', payload, { id: userId, role: 'ADMIN' });
    }
  };
})();