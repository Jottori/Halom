// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../libraries/GovernanceMath.sol";
import "../libraries/GovernanceErrors.sol";

/**
 * @title Oracle
 * @dev Decentralized oracle for price feeds and data submission
 */
contract Oracle is 
    Initializable, 
    AccessControlUpgradeable, 
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable 
{
    using GovernanceMath for uint256;
    
    // Role definitions
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    // Price data structure
    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 blockNumber;
        bool isValid;
    }

    // Oracle configuration
    mapping(bytes32 => PriceData) public priceFeeds;
    mapping(address => bool) public authorizedOracles;
    address[] public oracleAddresses;
    
    uint256 public minOracleCount;
    uint256 public priceValidityPeriod;
    uint256 public priceSubmissionCooldown;
    
    mapping(bytes32 => mapping(address => uint256)) public lastSubmissionTime;

    // Events
    event PriceUpdated(
        bytes32 indexed key,
        uint256 price,
        uint256 timestamp,
        address indexed oracle
    );
    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event PriceValidityPeriodSet(uint256 oldPeriod, uint256 newPeriod);
    event MinOracleCountSet(uint256 oldCount, uint256 newCount);
    event Upgraded(address indexed implementation);

    // Errors
    error InvalidPrice();
    error PriceTooOld();
    error CooldownNotExpired();
    error OracleNotAuthorized();
    error InsufficientOracles();
    error InvalidOracleAddress();
    error PriceKeyNotFound();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        uint256 _minOracleCount,
        uint256 _priceValidityPeriod,
        uint256 _priceSubmissionCooldown
    ) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
        _grantRole(GOVERNOR_ROLE, admin);

        minOracleCount = _minOracleCount;
        priceValidityPeriod = _priceValidityPeriod;
        priceSubmissionCooldown = _priceSubmissionCooldown;
    }

    // ============ ROLE-BASED FUNCTIONS ============

    /**
     * @dev Submit price data - only ORACLE_ROLE
     */
    function submitPrice(bytes32 key, uint256 price) 
        external 
        onlyRole(ORACLE_ROLE) 
        whenNotPaused 
        nonReentrant 
    {
        if (price == 0) revert InvalidPrice();
        if (!authorizedOracles[msg.sender]) revert OracleNotAuthorized();
        if (lastSubmissionTime[key][msg.sender] + priceSubmissionCooldown > block.timestamp) {
            revert CooldownNotExpired();
        }

        // Update price data
        priceFeeds[key] = PriceData({
            price: price,
            timestamp: block.timestamp,
            blockNumber: block.number,
            isValid: true
        });

        lastSubmissionTime[key][msg.sender] = block.timestamp;

        emit PriceUpdated(key, price, block.timestamp, msg.sender);
    }

    /**
     * @dev Add oracle address - only GOVERNOR_ROLE
     */
    function addOracle(address oracle) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (oracle == address(0)) revert InvalidOracleAddress();
        if (authorizedOracles[oracle]) revert InvalidOracleAddress();

        authorizedOracles[oracle] = true;
        oracleAddresses.push(oracle);
        _grantRole(ORACLE_ROLE, oracle);

        emit OracleAdded(oracle);
    }

    /**
     * @dev Remove oracle address - only GOVERNOR_ROLE
     */
    function removeOracle(address oracle) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (!authorizedOracles[oracle]) revert InvalidOracleAddress();

        authorizedOracles[oracle] = false;
        _revokeRole(ORACLE_ROLE, oracle);

        // Remove from oracleAddresses array
        for (uint256 i = 0; i < oracleAddresses.length; i++) {
            if (oracleAddresses[i] == oracle) {
                oracleAddresses[i] = oracleAddresses[oracleAddresses.length - 1];
                oracleAddresses.pop();
                break;
            }
        }

        emit OracleRemoved(oracle);
    }

    /**
     * @dev Set price validity period - only GOVERNOR_ROLE
     */
    function setPriceValidityPeriod(uint256 period) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (period == 0) revert InvalidPrice();
        
        uint256 oldPeriod = priceValidityPeriod;
        priceValidityPeriod = period;
        emit PriceValidityPeriodSet(oldPeriod, period);
    }

    /**
     * @dev Set minimum oracle count - only GOVERNOR_ROLE
     */
    function setMinOracleCount(uint256 count) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        if (count == 0) revert InvalidPrice();
        if (count > oracleAddresses.length) revert InsufficientOracles();
        
        uint256 oldCount = minOracleCount;
        minOracleCount = count;
        emit MinOracleCountSet(oldCount, count);
    }

    /**
     * @dev Set price submission cooldown - only GOVERNOR_ROLE
     */
    function setPriceSubmissionCooldown(uint256 cooldown) 
        external 
        onlyRole(GOVERNOR_ROLE) 
    {
        priceSubmissionCooldown = cooldown;
    }

    /**
     * @dev Pause oracle - only GOVERNOR_ROLE
     */
    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    /**
     * @dev Unpause oracle - only GOVERNOR_ROLE
     */
    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    /**
     * @dev Upgrade contract - only DEFAULT_ADMIN_ROLE
     */
    function upgradeTo(address newImplementation) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        _upgradeToAndCall(newImplementation, "", false);
        emit Upgraded(newImplementation);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Required by UUPSUpgradeable
     */
    function _authorizeUpgrade(address newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}

    // ============ VIEW FUNCTIONS ============

    /**
     * @dev Get latest price for a key
     */
    function getLatestPrice(bytes32 key) 
        external 
        view 
        returns (uint256 price, uint256 timestamp, bool isValid) 
    {
        PriceData memory data = priceFeeds[key];
        
        if (!data.isValid) revert PriceKeyNotFound();
        if (block.timestamp - data.timestamp > priceValidityPeriod) {
            revert PriceTooOld();
        }

        return (data.price, data.timestamp, data.isValid);
    }

    /**
     * @dev Get price data for a key
     */
    function getPriceData(bytes32 key) 
        external 
        view 
        returns (PriceData memory) 
    {
        return priceFeeds[key];
    }

    /**
     * @dev Check if price is valid
     */
    function isPriceValid(bytes32 key) 
        external 
        view 
        returns (bool) 
    {
        PriceData memory data = priceFeeds[key];
        return data.isValid && (block.timestamp - data.timestamp <= priceValidityPeriod);
    }

    /**
     * @dev Get all authorized oracles
     */
    function getAuthorizedOracles() 
        external 
        view 
        returns (address[] memory) 
    {
        return oracleAddresses;
    }

    /**
     * @dev Get oracle count
     */
    function getOracleCount() external view returns (uint256) {
        return oracleAddresses.length;
    }

    /**
     * @dev Get oracle configuration
     */
    function getOracleConfig() 
        external 
        view 
        returns (
            uint256 _minOracleCount,
            uint256 _priceValidityPeriod,
            uint256 _priceSubmissionCooldown
        ) 
    {
        return (minOracleCount, priceValidityPeriod, priceSubmissionCooldown);
    }

    /**
     * @dev Check if address is authorized oracle
     */
    function isAuthorizedOracle(address oracle) external view returns (bool) {
        return authorizedOracles[oracle];
    }

    /**
     * @dev Get last submission time for oracle and key
     */
    function getLastSubmissionTime(bytes32 key, address oracle) 
        external 
        view 
        returns (uint256) 
    {
        return lastSubmissionTime[key][oracle];
    }
} 