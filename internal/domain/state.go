package domain

var transitions = map[string]map[string][]string{
	"slot":     {"available": {"offer_pending", "booked", "closed"}, "offer_pending": {"available", "booked", "closed"}, "booked": {"available", "closed"}},
	"offer":    {"pending": {"accepted", "declined", "expired", "revoked"}},
	"waitlist": {"active": {"paused", "satisfied", "withdrawn"}, "paused": {"active", "withdrawn"}},
}

func CanTransition(entity, from, to string) bool {
	for _, allowed := range transitions[entity][from] {
		if allowed == to {
			return true
		}
	}
	return false
}
