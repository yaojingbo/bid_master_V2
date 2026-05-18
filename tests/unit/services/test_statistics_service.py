"""Unit tests for StatisticsService."""
import pytest
from app.services.statistics_service import StatisticsService


class TestStatisticsService:
    """Test cases for StatisticsService."""

    @pytest.fixture
    def service(self):
        """Create a service instance."""
        return StatisticsService()

    def test_calculate_price_statistics_basic(self, service):
        """Test basic price statistics calculation."""
        prices = [100, 200, 300, 400, 500]

        result = service.calculate_price_statistics(prices)

        assert result["count"] == 5
        assert result["average"] == 300
        assert result["min"] == 100
        assert result["max"] == 500
        assert result["median"] == 300

    def test_calculate_price_statistics_single_price(self, service):
        """Test statistics with single price."""
        prices = [100]

        result = service.calculate_price_statistics(prices)

        assert result["count"] == 1
        assert result["average"] == 100
        assert result["min"] == 100
        assert result["max"] == 100

    def test_calculate_price_statistics_empty(self, service):
        """Test statistics with empty list."""
        prices = []

        with pytest.raises(ValueError, match="No prices provided"):
            service.calculate_price_statistics(prices)

    def test_calculate_dispersion_coefficient(self, service):
        """Test dispersion coefficient calculation."""
        prices = [100, 200, 300, 400, 500]

        result = service.calculate_price_statistics(prices)

        assert "dispersion_coefficient" in result
        assert result["dispersion_coefficient"] > 0

    def test_calculate_price_rankings(self, service):
        """Test price rankings calculation."""
        prices = [100, 200, 300, 400, 500]

        result = service.calculate_price_statistics(prices)

        assert len(result["price_rankings"]) == 5
        assert result["price_rankings"][0]["rank"] == 1
        assert result["price_rankings"][0]["price"] == 100

    def test_calculate_price_changes(self, service):
        """Test price changes calculation."""
        prices = [100, 110, 120, 115, 105]

        result = service.calculate_price_statistics(prices)

        assert len(result["price_changes"]) == 4
        assert result["price_changes"][0] == 10  # 10% increase

    def test_statistics_with_decimals(self, service):
        """Test statistics with decimal values."""
        prices = [100.5, 200.75, 300.25]

        result = service.calculate_price_statistics(prices)

        assert result["average"] == pytest.approx(200.5, rel=0.01)

    def test_statistics_with_identical_prices(self, service):
        """Test statistics with identical prices."""
        prices = [100, 100, 100, 100]

        result = service.calculate_price_statistics(prices)

        assert result["dispersion_coefficient"] == 0
        assert result["median"] == 100
