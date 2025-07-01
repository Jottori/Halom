# Halom Oracle Metrics Specification

## Overview

The Halom Oracle system provides real-time economic data for the protocol's rebase mechanism and governance decisions. This document specifies the data sources, priorities, fallback mechanisms, and validation procedures.

## 1. Data Sources and APIs

### 1.1 Primary Data Sources

#### IMF Minimum Wage Index
- **API Endpoint**: `https://api.imf.org/v1/databases/IFS/data`
- **Data Series**: `NGDP_RPCH` (Real GDP per capita growth)
- **Update Frequency**: Monthly
- **Priority**: 1 (Highest)
- **Fallback**: World Bank data

#### FAO Food Price Index
- **API Endpoint**: `https://api.fao.org/v1/food-price-index`
- **Data Series**: `FPI` (Food Price Index)
- **Update Frequency**: Monthly
- **Priority**: 2
- **Fallback**: UN Comtrade data

#### World Bank GINI Index
- **API Endpoint**: `https://api.worldbank.org/v2/countries/all/indicators/SI.POV.GINI`
- **Data Series**: `SI.POV.GINI` (Gini coefficient)
- **Update Frequency**: Annual
- **Priority**: 3
- **Fallback**: OECD data

#### OECD Employment Rate
- **API Endpoint**: `https://stats.oecd.org/restsdmx/sdmx.ashx/GetData/`
- **Data Series**: `LFS_SEXAGE_I_R` (Employment rate by sex and age)
- **Update Frequency**: Quarterly
- **Priority**: 4
- **Fallback**: ILO data

### 1.2 Secondary Data Sources

#### UN Comtrade
- **Purpose**: Trade data for economic health assessment
- **Update Frequency**: Monthly
- **Priority**: 5

#### ILO Labor Statistics
- **Purpose**: Employment and wage data
- **Update Frequency**: Quarterly
- **Priority**: 6

#### ECB Economic Indicators
- **Purpose**: European economic data
- **Update Frequency**: Monthly
- **Priority**: 7

## 2. Data Processing and Validation

### 2.1 Sanity Checks

#### Outlier Detection
```python
def detect_outliers(data, threshold=3):
    """
    Detect outliers using Z-score method
    """
    z_scores = np.abs(stats.zscore(data))
    return z_scores > threshold
```

#### Range Validation
- **Minimum Values**: Based on historical data (last 10 years)
- **Maximum Values**: Based on historical data + 50% buffer
- **Rate of Change**: Maximum 20% change per update period

#### Data Quality Checks
- **Completeness**: All required fields must be present
- **Consistency**: Cross-reference with multiple sources
- **Timeliness**: Data should not be older than 30 days

### 2.2 Data Aggregation

#### Weighted Average Calculation
```python
def calculate_weighted_average(data_sources, weights):
    """
    Calculate weighted average of multiple data sources
    """
    weighted_sum = sum(data * weight for data, weight in zip(data_sources, weights))
    total_weight = sum(weights)
    return weighted_sum / total_weight
```

#### Regional Weighting
- **Developed Countries**: 60% weight
- **Emerging Markets**: 30% weight
- **Developing Countries**: 10% weight

## 3. Fallback Mechanisms

### 3.1 Primary Fallback Chain
1. **IMF** → **World Bank** → **OECD** → **UN**
2. **FAO** → **UN Comtrade** → **National Statistics**
3. **World Bank** → **OECD** → **Regional Banks**

### 3.2 Emergency Fallback
- **Last Known Good Value**: Use previous valid data point
- **Historical Average**: Use 30-day moving average
- **Default Values**: Predefined safe defaults

### 3.3 Fallback Triggers
- **API Timeout**: > 30 seconds
- **Data Age**: > 7 days old
- **Outlier Detection**: Z-score > 3
- **Missing Data**: > 20% of sources unavailable

## 4. Update Frequency and Scheduling

### 4.1 Update Schedule
- **Primary Sources**: Every 6 hours
- **Secondary Sources**: Every 12 hours
- **Validation**: Every hour
- **Emergency Updates**: On-demand

### 4.2 Rate Limiting
- **API Calls**: Maximum 100 calls per hour per source
- **Update Frequency**: Minimum 1 hour between updates
- **Retry Logic**: Exponential backoff (1s, 2s, 4s, 8s, 16s)

### 4.3 Update Priority
1. **Critical Updates**: Data change > 10%
2. **Regular Updates**: Scheduled intervals
3. **Maintenance Updates**: System health checks

## 5. Error Handling and Monitoring

### 5.1 Error Types
- **Network Errors**: API timeouts, connection failures
- **Data Errors**: Invalid format, missing fields
- **Validation Errors**: Outliers, range violations
- **System Errors**: Memory, disk space, permissions

### 5.2 Error Response
- **Logging**: All errors logged with timestamps
- **Alerting**: Critical errors trigger notifications
- **Recovery**: Automatic fallback to secondary sources
- **Reporting**: Daily error summary reports

### 5.3 Monitoring Metrics
- **Uptime**: Target 99.9%
- **Data Freshness**: < 24 hours old
- **Accuracy**: < 5% deviation from consensus
- **Response Time**: < 30 seconds

## 6. Security and Access Control

### 6.1 API Access
- **Authentication**: API keys for all sources
- **Rate Limiting**: Respect source limits
- **Encryption**: HTTPS for all communications
- **Audit Logging**: All access attempts logged

### 6.2 Data Integrity
- **Checksums**: Verify data integrity
- **Digital Signatures**: Sign critical updates
- **Backup**: Multiple data copies
- **Version Control**: Track all data changes

## 7. Integration with Smart Contracts

### 7.1 Oracle Contract Interface
```solidity
interface IHalomOracle {
    function setHOI(uint256 _hoiValue, uint256 _nonce) external;
    function getHOI() external view returns (uint256);
    function getLastUpdate() external view returns (uint256);
    function getDataSources() external view returns (string[] memory);
}
```

### 7.2 Update Process
1. **Data Collection**: Gather from all sources
2. **Validation**: Apply sanity checks
3. **Aggregation**: Calculate weighted average
4. **Submission**: Submit to smart contract
5. **Confirmation**: Verify on-chain update

### 7.3 Gas Optimization
- **Batch Updates**: Multiple values in single transaction
- **Compression**: Use efficient data encoding
- **Caching**: Cache frequently accessed data
- **Batching**: Group related updates

## 8. Economic Model Integration

### 8.1 HOI (Halom Opportunity Index) Calculation
```python
def calculate_hoi(metrics):
    """
    Calculate HOI from economic metrics
    """
    gdp_weight = 0.4
    employment_weight = 0.3
    inequality_weight = 0.2
    food_weight = 0.1
    
    hoi = (
        metrics['gdp_growth'] * gdp_weight +
        metrics['employment_rate'] * employment_weight +
        (1 - metrics['gini_coefficient']) * inequality_weight +
        (1 - metrics['food_price_index']) * food_weight
    )
    
    return max(0, min(10, hoi))  # Clamp between 0 and 10
```

### 8.2 Rebase Trigger Conditions
- **HOI Threshold**: > 5.0 triggers positive rebase
- **HOI Threshold**: < 3.0 triggers negative rebase
- **Change Threshold**: > 0.5 change triggers update
- **Time Threshold**: Minimum 24 hours between rebases

## 9. Testing and Validation

### 9.1 Test Scenarios
- **Normal Operation**: Standard data flow
- **API Failures**: Simulate source failures
- **Data Corruption**: Invalid data handling
- **Network Issues**: Connectivity problems
- **Load Testing**: High-frequency updates

### 9.2 Validation Criteria
- **Accuracy**: < 5% deviation from expected
- **Reliability**: 99.9% uptime
- **Performance**: < 30 second response time
- **Security**: No unauthorized access

## 10. Maintenance and Support

### 10.1 Regular Maintenance
- **Data Source Review**: Monthly source evaluation
- **Performance Optimization**: Quarterly performance review
- **Security Updates**: Monthly security patches
- **Documentation Updates**: As needed

### 10.2 Support Procedures
- **Issue Reporting**: GitHub issues
- **Emergency Contacts**: 24/7 on-call rotation
- **Escalation Matrix**: Clear escalation paths
- **Post-Incident Review**: Root cause analysis

## 11. Future Enhancements

### 11.1 Planned Improvements
- **Machine Learning**: Predictive analytics
- **Real-time Streaming**: WebSocket connections
- **Decentralized Sources**: Chainlink integration
- **Advanced Validation**: AI-powered anomaly detection

### 11.2 Scalability Considerations
- **Horizontal Scaling**: Multiple oracle nodes
- **Load Balancing**: Distribute API calls
- **Caching Strategy**: Redis implementation
- **Database Optimization**: Query optimization

---

**Document Version**: 1.0  
**Last Updated**: 2024-01-XX  
**Next Review**: 2024-02-XX  
**Maintainer**: Halom Development Team 