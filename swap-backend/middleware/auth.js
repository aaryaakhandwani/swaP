// middleware/auth.js

/**
 * Require authenticated session
 */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  if (req.session && req.session.userId) return next();
  
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/login.html?redirect=' + encodeURIComponent(req.originalUrl));
}

/**
 * Require specific plan (essential or pro)
 */
function requirePlan(minPlan) {
  const planLevels = { free: 0, essential: 1, pro: 2 };
  return (req, res, next) => {
    const userPlan = req.user?.plan || 'free';
    if (planLevels[userPlan] >= planLevels[minPlan]) return next();
    res.status(403).json({
      error: 'Plan upgrade required',
      required: minPlan,
      current: userPlan,
    });
  };
}

/**
 * Optional auth — attach user if logged in but don't block
 */
function optionalAuth(req, res, next) {
  next();
}

module.exports = { requireAuth, requirePlan, optionalAuth };
