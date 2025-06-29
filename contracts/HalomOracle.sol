// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./HalomToken.sol"; // Using local import for interface
import "./interfaces/IHalomInterfaces.sol";

contract HalomOracle is AccessControl, Pausable, ReentrancyGuard {
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant ORACLE_UPDATER_ROLE = keccak256("ORACLE_UPDATER_ROLE");

    IHalomToken public halomToken;
    uint256 public latestHOI;
    uint256 public lastUpdateTime;
    uint256 public nonce;
    uint256 public immutable chainId;

    uint256 public constant MAX_HOI_VALUE = 10000000000; // 10.0 in 9 decimals
    uint256 public constant MIN_UPDATE_INTERVAL = 1 hours;

    event HOISet(uint256 newHOI, int256 supplyDelta, uint256 indexed nonce);
    event HOIUpdated(uint256 newHOI, int256 supplyDelta, uint256 timestamp);

    constructor(address _governance, uint256 _chainId) {
        chainId = _chainId;
        _grantRole(DEFAULT_ADMIN_ROLE, _governance);
        _grantRole(GOVERNOR_ROLE, _governance);
        // The ORACLE_UPDATER_ROLE should be granted to a Gnosis Safe multisig wallet.
    }

    function pause() external onlyRole(GOVERNOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(GOVERNOR_ROLE) {
        _unpause();
    }

    function setHalomToken(address _halomToken) external onlyRole(GOVERNOR_ROLE) {
        require(_halomToken != address(0), "Zero address");
        halomToken = IHalomToken(_halomToken);
    }
    
    function setHOI(uint256 _hoi, uint256 _nonce) external onlyRole(ORACLE_UPDATER_ROLE) whenNotPaused nonReentrant {
        require(_hoi > 0, "HOI must be positive");
        require(_hoi <= MAX_HOI_VALUE, "HOI exceeds maximum");
        require(_nonce == nonce, "HalomOracle: Invalid nonce");
        
        // Rate limiting
        require(block.timestamp >= lastUpdateTime + MIN_UPDATE_INTERVAL, "Update too frequent");
        
        // Deviation check for security
        if (latestHOI > 0) {
            uint256 deviation = _calculateDeviation(latestHOI, _hoi);
            require(deviation <= 50, "HOI deviation too high"); // 50% max deviation
        }
        
        // State changes before external call
        latestHOI = _hoi;
        lastUpdateTime = block.timestamp;
        nonce++;
        
        // Calculate supply delta
        uint256 S = halomToken.totalSupply();
        int256 supplyDelta;
        
        if (lastUpdateTime == 0) { // First rebase
            // Assume the peg is 1:1 initially, so calculate the delta from a hypothetical previous HOI of 1*10^9
            uint256 initialPeg = 1e9;
            supplyDelta = int256((_hoi * S) / initialPeg) - int256(S);
        } else {
            supplyDelta = int256((_hoi * S) / latestHOI) - int256(S);
        }
        
        // External call after state changes
        if (supplyDelta != 0) {
            halomToken.rebase(supplyDelta);
        }
        
        emit HOIUpdated(_hoi, supplyDelta, block.timestamp);
    }
    
    function _calculateDeviation(uint256 oldValue, uint256 newValue) internal pure returns (uint256) {
        if (oldValue == 0) return 0;
        uint256 diff = newValue > oldValue ? newValue - oldValue : oldValue - newValue;
        return (diff * 100) / oldValue;
    }
} 