package appointments

import (
	"context"
	"errors"
	"github.com/REinstall-SyS/WaitlistFair/internal/domain"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Accept(ctx context.Context, a Actor, offerID, key string) (string, error) {
	var result string
	err := s.transaction(ctx, func(tx pgx.Tx) error {
		if e := Authorize(ctx, tx, a); e != nil {
			return e
		}
		var slotID string
		if e := tx.QueryRow(ctx, `SELECT slot_id FROM offers WHERE id=$1 AND organization_id=$2 AND recipient_id=$3`, offerID, a.OrgID, a.UserID).Scan(&slotID); e != nil {
			if errors.Is(e, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return e
		}
		slot, e := lockSlot(ctx, tx, a.OrgID, slotID)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, a.UserID); e != nil {
			return e
		}
		if e = Authorize(ctx, tx, a); e != nil {
			return e
		}
		if a.Role != "student" {
			return ErrForbidden
		}
		op := "accept:" + offerID
		result, e = replay(ctx, tx, a, key, op)
		if e != nil || result != "" {
			return e
		}
		var state, claim, entry string
		var valid bool
		if e = tx.QueryRow(ctx, `SELECT state,claim_id,entry_id,expires_at>clock_timestamp() FROM offers WHERE id=$1 FOR UPDATE`, offerID).Scan(&state, &claim, &entry, &valid); e != nil {
			return e
		}
		if state == "accepted" {
			if e = tx.QueryRow(ctx, `SELECT id FROM bookings WHERE claim_id=$1 AND state='confirmed'`, claim).Scan(&result); e != nil {
				return ErrConflict
			}
			return remember(ctx, tx, a, key, op, result)
		}
		if !domain.CanTransition("offer", state, "accepted") || !valid || slot.State != "offer_pending" {
			return ErrConflict
		}
		var active bool
		if e = tx.QueryRow(ctx, `SELECT status='active' FROM waitlist_entries WHERE id=$1 FOR UPDATE`, entry).Scan(&active); e != nil {
			return e
		}
		if !active {
			return ErrConflict
		}
		result, e = s.confirm(ctx, tx, slot, a.UserID, claim)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE offers SET state='accepted',resolved_at=clock_timestamp() WHERE id=$1`, offerID); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, `UPDATE waitlist_entries SET status='satisfied' WHERE id=$1`, entry); e != nil {
			return e
		}
		if e = remember(ctx, tx, a, key, op, result); e != nil {
			return e
		}
		return Audit(ctx, tx, a.OrgID, a.UserID, "OfferAccepted", offerID, map[string]string{"booking_id": result})
	})
	return result, err
}
func (s *Service) Decline(ctx context.Context, a Actor, offerID string) error {
	return s.transaction(ctx, func(tx pgx.Tx) error {
		if e := Authorize(ctx, tx, a); e != nil {
			return e
		}
		var slotID string
		e := tx.QueryRow(ctx, `SELECT slot_id FROM offers WHERE id=$1 AND organization_id=$2 AND recipient_id=$3`, offerID, a.OrgID, a.UserID).Scan(&slotID)
		if e != nil {
			return ErrNotFound
		}
		slot, e := lockSlot(ctx, tx, a.OrgID, slotID)
		if e != nil {
			return e
		}
		var state, claim string
		var valid bool
		if e = tx.QueryRow(ctx, `SELECT state,claim_id,expires_at>clock_timestamp() FROM offers WHERE id=$1`, offerID).Scan(&state, &claim, &valid); e != nil {
			return e
		}
		if state == "declined" {
			return nil
		}
		if !domain.CanTransition("offer", state, "declined") || !valid || slot.State != "offer_pending" {
			return ErrConflict
		}
		if e = resolve(ctx, tx, offerID, claim, slot.ID, "declined"); e != nil {
			return e
		}
		if e = Event(ctx, tx, "OfferDeclined", map[string]string{"offer_id": offerID}); e != nil {
			return e
		}
		if e = Audit(ctx, tx, a.OrgID, a.UserID, "OfferDeclined", offerID, nil); e != nil {
			return e
		}
		slot.State = "available"
		return s.allocate(ctx, tx, slot)
	})
}
func resolve(ctx context.Context, tx pgx.Tx, offer, claim, slot, state string) error {
	if _, e := tx.Exec(ctx, `UPDATE offers SET state=$2,resolved_at=clock_timestamp() WHERE id=$1`, offer, state); e != nil {
		return e
	}
	if _, e := tx.Exec(ctx, `UPDATE claims SET state='released' WHERE id=$1`, claim); e != nil {
		return e
	}
	_, e := tx.Exec(ctx, `UPDATE slots SET state='available' WHERE id=$1`, slot)
	return e
}
func (s *Service) Expire(ctx context.Context, org, offerID string) error {
	return s.transaction(ctx, func(tx pgx.Tx) error {
		var slotID string
		e := tx.QueryRow(ctx, `SELECT slot_id FROM offers WHERE id=$1 AND organization_id=$2`, offerID, org).Scan(&slotID)
		if e != nil {
			return e
		}
		slot, e := lockSlot(ctx, tx, org, slotID)
		if e != nil {
			return e
		}
		var claim, state string
		var expired bool
		if e = tx.QueryRow(ctx, `SELECT claim_id,state,expires_at<=clock_timestamp() FROM offers WHERE id=$1`, offerID).Scan(&claim, &state, &expired); e != nil {
			return e
		}
		if !domain.CanTransition("offer", state, "expired") || !expired {
			return nil
		}
		if e = resolve(ctx, tx, offerID, claim, slot.ID, "expired"); e != nil {
			return e
		}
		if e = Event(ctx, tx, "OfferExpired", map[string]string{"offer_id": offerID}); e != nil {
			return e
		}
		if e = Audit(ctx, tx, org, "", "OfferExpired", offerID, nil); e != nil {
			return e
		}
		slot.State = "available"
		return s.allocate(ctx, tx, slot)
	})
}
func (s *Service) Sweep(ctx context.Context) error {
	rows, e := s.DB.Query(ctx, `SELECT organization_id,id FROM offers WHERE state='pending' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 50`)
	if e != nil {
		return e
	}
	type item struct{ org, id string }
	list := []item{}
	for rows.Next() {
		var v item
		if e = rows.Scan(&v.org, &v.id); e != nil {
			rows.Close()
			return e
		}
		list = append(list, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range list {
		if e = s.Expire(ctx, v.org, v.id); e != nil {
			return e
		}
	}
	return nil
}
