// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "../core/Token.sol";

/**
 * @title HalomGovernor
 * @dev Governance contract for Halom protocol with fourth root voting power
 */
contract HalomGovernor is 
    Governor, 
    GovernorTimelockControl, 
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction 
{
    mapping(address => uint256) public lockedTokens;
    mapping(address => uint256) public lockTime;
    uint256 public constant LOCK_DURATION = 5 * 365 * 24 * 60 * 60; // 5 years
    uint256 public constant VOTING_DELAY = 1; // 1 block
    uint256 public constant VOTING_PERIOD = 45818; // ~1 week
    uint256 public constant PROPOSAL_THRESHOLD = 1000e18; // 1000 HLM
    uint256 public constant QUORUM_FRACTION = 4; // 4%

    event TokensLocked(address indexed user, uint256 amount, uint256 lockTime);
    event TokensUnlocked(address indexed user, uint256 amount);

    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("HalomGovernor")
        GovernorSettings(VOTING_DELAY, VOTING_PERIOD, PROPOSAL_THRESHOLD)
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(QUORUM_FRACTION)
        GovernorTimelockControl(_timelock)
    {}

    /**
     * @dev Calculate fourth root using Babylonian method
     */
    function fourthRoot(uint256 x) public pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = x;
        uint256 y = (z + 3) / 4;
        
        while (y < z) {
            z = y;
            y = (z + x / (z * z * z)) / 4;
        }
        return z;
    }

    /**
     * @dev Get voting power for a user based on locked tokens
     */
    function getVotePower(address user) public view returns (uint256) {
        if (lockTime[user] == 0) return 0;
        if (block.timestamp < lockTime[user] + LOCK_DURATION) {
            return fourthRoot(lockedTokens[user]);
        }
        return 0; // Lock expired
    }

    /**
     * @dev Lock tokens for governance participation
     */
    function lockTokens(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");
        require(
            HalomToken(address(token)).transferFrom(msg.sender, address(this), amount),
            "Transfer failed"
        );
        
        lockedTokens[msg.sender] += amount;
        lockTime[msg.sender] = block.timestamp;
        
        emit TokensLocked(msg.sender, amount, block.timestamp);
    }

    /**
     * @dev Unlock tokens after lock period
     */
    function unlockTokens() external {
        require(lockTime[msg.sender] > 0, "No tokens locked");
        require(
            block.timestamp >= lockTime[msg.sender] + LOCK_DURATION,
            "Lock period not expired"
        );
        
        uint256 amount = lockedTokens[msg.sender];
        lockedTokens[msg.sender] = 0;
        lockTime[msg.sender] = 0;
        
        require(
            HalomToken(address(token)).transfer(msg.sender, amount),
            "Transfer failed"
        );
        
        emit TokensUnlocked(msg.sender, amount);
    }

    /**
     * @dev Override to use custom voting power
     */
    function _getVotes(
        address account,
        uint256 blockNumber,
        bytes memory /*params*/
    ) internal view virtual override(Governor, GovernorVotes) returns (uint256) {
        return getVotePower(account);
    }

    // The following functions are overrides required by Solidity.

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override(Governor) returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor)
        returns (address)
    {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
} 
