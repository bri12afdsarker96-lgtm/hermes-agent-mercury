"""Gate 2C-A G2CA-04: settle always charges the original UTC bucket."""
from __future__ import annotations

from plugins.spike_p3_m0_budget.tests.test_budget_reserve import _enable_budget


def test_cross_utc_midnight_settle_charges_the_original_reservation_bucket(
    tmp_path, monkeypatch
):
    """A reservation made before midnight cannot be charged to the next day."""
    _, budget_mod = _enable_budget(tmp_path, monkeypatch)
    tenant_id = "t_cross_utc"
    request_id = "g2ca04-midnight"
    day_before = "2026-08-09"
    day_after = "2026-08-10"
    current_day = {"value": day_before}
    monkeypatch.setattr(budget_mod, "_today_utc", lambda: current_day["value"])

    budget_mod.reserve(tenant_id, request_id, 80, budget=100)
    assert budget_mod.get_reservation(tenant_id, request_id) == 80

    current_day["value"] = day_after
    budget_mod.settle(tenant_id, request_id, 60)

    # The day after the midnight boundary must remain uncharged.
    assert budget_mod.get_used(tenant_id) == 0
    assert budget_mod.get_pending_total(tenant_id) == 0
    assert budget_mod.get_reservation(tenant_id, request_id) is None

    # Switching the clock back reveals the actual charge in the original bucket.
    current_day["value"] = day_before
    assert budget_mod.get_used(tenant_id) == 60
    assert budget_mod.get_pending_total(tenant_id) == 0
