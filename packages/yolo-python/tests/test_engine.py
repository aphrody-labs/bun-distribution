import pytest
from yolo import DataBatch, analyze_batch


def test_data_batch():
    batch = DataBatch(batch_name="batch-01", values=[1.0, 2.0, 3.0])
    res = analyze_batch(batch)
    assert res["sum"] == pytest.approx(6.0)
    assert res["mean"] == pytest.approx(2.0)
    assert res["sum_sq"] == pytest.approx(14.0)
    assert res["count"] == 3.0


def test_data_batch_empty():
    batch = DataBatch(batch_name="empty-batch", values=[])
    res = analyze_batch(batch)
    assert res["sum"] == 0.0
    assert res["count"] == 0.0


def test_polars_export():
    batch = DataBatch(batch_name="df-batch", values=[10.0, 20.0, 30.0])
    df = batch.to_polars()
    assert df.shape == (3, 1)
    assert df["values"].to_list() == [10.0, 20.0, 30.0]
