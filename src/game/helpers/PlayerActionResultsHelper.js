// Helper methods related to rewards from player actions such as scavenging and scouting
define([
	'ash',
	'text/Text',
	'utils/MathUtils',
	'game/GameGlobals',
	'game/GlobalSignals',
	'game/constants/GameConstants',
	'game/constants/ExplorationConstants',
	'game/constants/FightConstants',
	'game/constants/FollowerConstants',
	'game/constants/LocaleConstants',
	'game/constants/PlayerActionConstants',
	'game/constants/LogConstants',
	'game/constants/SectorConstants',
	'game/constants/TextConstants',
	'game/constants/ItemConstants',
	'game/constants/PerkConstants',
	'game/constants/UpgradeConstants',
	'game/constants/UIConstants',
	'game/constants/WorldConstants',
	'game/nodes/player/PlayerStatsNode',
	'game/nodes/PlayerLocationNode',
	'game/nodes/player/PlayerResourcesNode',
	'game/nodes/tribe/TribeUpgradesNode',
	'game/nodes/sector/CampNode',
	'game/nodes/LastVisitedCampNode',
	'game/nodes/NearestCampNode',
	'game/components/common/CampComponent',
	'game/components/common/PositionComponent',
	'game/components/common/ResourcesComponent',
	'game/components/common/CurrencyComponent',
	'game/components/common/LogMessagesComponent',
	'game/components/sector/SectorFeaturesComponent',
	'game/components/sector/SectorStatusComponent',
	'game/components/sector/SectorLocalesComponent',
	'game/components/player/ItemsComponent',
	'game/components/player/BagComponent',
	'game/components/player/DeityComponent',
	'game/components/player/ExcursionComponent',
	'game/components/type/LevelComponent',
	'game/vos/ResultVO',
	'game/vos/ResourcesVO'
], function (
	Ash,
	Text,
	MathUtils,
	GameGlobals,
	GlobalSignals,
	GameConstants,
	ExplorationConstants,
	FightConstants,
	FollowerConstants,
	LocaleConstants,
	PlayerActionConstants,
	LogConstants,
	SectorConstants,
	TextConstants,
	ItemConstants,
	PerkConstants,
	UpgradeConstants,
	UIConstants,
	WorldConstants,
	PlayerStatsNode,
	PlayerLocationNode,
	PlayerResourcesNode,
	TribeUpgradesNode,
	CampNode,
	LastVisitedCampNode,
	NearestCampNode,
	CampComponent,
	PositionComponent,
	ResourcesComponent,
	CurrencyComponent,
	LogMessagesComponent,
	SectorFeaturesComponent,
	SectorStatusComponent,
	SectorLocalesComponent,
	ItemsComponent,
	BagComponent,
	DeityComponent,
	ExcursionComponent,
	LevelComponent,
	ResultVO,
	ResourcesVO
) {
	var PlayerActionResultsHelper = Ash.Class.extend({

		playerStatsNodes: null,
		playerResourcesNodes: null,
		playerLocationNodes: null,
		tribeUpgradesNodes: null,

		RESULT_MGS_FORMAT_LOG: "RESULT_MGS_FORMAT_LOG",
		RESULT_MSG_FORMAT_PREVIW: "RESULT_MSG_FORMAT_PREVIW",

		fixedRewards: {
			"scavenge": [
				{ resources: { metal: 1 } },
				{ resources: { metal: 1 } },
				{ resources: { food: 1, metal: 1 } },
				{ },
				{ resources: { metal: 1 }, items: { "bag_0": 1 } },
				{ resources: { food: 1, metal: 1 } },
				{ resources: { metal: 1 } },
				{ resources: { metal: 1 } },
			]
		},
		
		context: "results",

		constructor: function (engine) {
			this.engine = engine;

			this.playerStatsNodes = engine.getNodeList(PlayerStatsNode);
			this.playerResourcesNodes = engine.getNodeList(PlayerResourcesNode);
			this.playerLocationNodes = engine.getNodeList(PlayerLocationNode);
			this.tribeUpgradesNodes = engine.getNodeList(TribeUpgradesNode);
			this.nearestCampNodes = engine.getNodeList(NearestCampNode);
			this.lastVisitedCampNodes = engine.getNodeList(LastVisitedCampNode);
			this.campNodes = engine.getNodeList(CampNode);
		},

		getResultVOByAction: function (action, hasCustomReward) {
			var baseActionID = GameGlobals.playerActionsHelper.getBaseActionID(action);

			var resultVO;
			switch (baseActionID) {
				case "scavenge":
					resultVO = this.getScavengeRewards();
					break;
				case "scout":
					resultVO = this.getScoutRewards();
					break;
				case "scout_locale_i":
				case "scout_locale_u":
					// TODO global helper to get locale vo from action?
					var localei = parseInt(action.split("_")[3]);
					var sectorLocalesComponent = this.playerLocationNodes.head.entity.get(SectorLocalesComponent);
					var localeVO = sectorLocalesComponent.locales[localei];
					resultVO = this.getScoutLocaleRewards(localeVO);
					break;
				case "investigate":
					resultVO = this.getInvestigateRewards();
					break;
				case "use_spring":
					resultVO = this.getUseSpringRewards();
					break;
				case "clear_workshop":
					resultVO = this.getClearWorkshopRewards();
					break;
				case "nap":
					resultVO = this.getNapRewards();
					break;
				case "clear_waste_r":
				case "clear_waste_t":
				case "wait":
					resultVO = new ResultVO(baseActionID);
					break;
				default:
					log.w("Unknown action: " + baseActionID + ". Can't create result vo.");
					return null;
			}

			let playerVision = this.playerStatsNodes.head.vision.value;
			let perksComponent = this.playerStatsNodes.head.perks;
			let playerLuck = perksComponent.getTotalEffect(PerkConstants.perkTypes.luck);
			let loseInventoryProbability = PlayerActionConstants.getLoseInventoryProbability(action, playerVision, playerLuck);
			this.addLostAndBrokenItems(resultVO, action, loseInventoryProbability, true);
			resultVO.gainedInjuries = this.getResultInjuries(PlayerActionConstants.getInjuryProbability(action, playerVision, playerLuck), action);
			resultVO.hasCustomReward = hasCustomReward;

			resultVO.collected = false;
			
			return resultVO;
		},

		getUseItemRewards: function (itemID) {
			let rewards = new ResultVO("use_item");
			
			let baseItemId = ItemConstants.getBaseItemId(itemID);
			let itemConfig = ItemConstants.getItemConfigByID(itemID);

			switch (baseItemId) {
				case "cache_food":
					rewards.gainedResources.addResource(resourceNames.food, itemConfig.configData.foodValue || 10);
					break;
				case "cache_water":
					rewards.gainedResources.addResource(resourceNames.water, itemConfig.configData.waterValue || 10);
					break;
			}

			return rewards;
		},

		getScavengeRewards: function () {
			let rewards = new ResultVO("scavenge");
			
			let sectorFeatures = this.playerLocationNodes.head.entity.get(SectorFeaturesComponent);
			let sectorStatus = this.playerLocationNodes.head.entity.get(SectorStatusComponent);
			let sectorResources = sectorFeatures.resourcesScavengable;
			let sectorIngredients = sectorFeatures.itemsScavengeable || [];
			let itemsComponent = this.playerStatsNodes.head.entity.get(ItemsComponent);
			let efficiency = this.getCurrentScavengeEfficiency();
			
			let itemOptions = { rarityKey: "scavengeRarity" };
			
			let fixedRewards = this.getFixedRewards("scavenge");
			let isUsingFixedRewards = false;
			
			if (fixedRewards != null) {
				isUsingFixedRewards = true;
				this.addFixedRewards(rewards, fixedRewards, sectorResources);
			}
			
			if (!isUsingFixedRewards) {
				rewards.gainedResources = this.getRewardResources(1, 1, efficiency, sectorResources);
				rewards.gainedCurrency = this.getRewardCurrency(efficiency);
			}
			
			this.addStashes(rewards, sectorFeatures.stashes, sectorStatus.stashesFound);
			
			if (!isUsingFixedRewards) {
				if (rewards.gainedItems.length == 0) {
					rewards.gainedItems = this.getRewardItems(0.02, 0.5, sectorIngredients, itemOptions);
				}
			
				if (rewards.foundStashVO == null && rewards.gainedCurrency == 0) {
					this.addFollowerBonuses(rewards, sectorResources, sectorIngredients, itemOptions);
				}
	
				rewards.gainedFollowers = this.getFallbackFollowers(0.1);
			}

			return rewards;
		},

		getInvestigateRewards: function () {
			let rewards = new ResultVO("investigate");

			let sectorFeatures = this.playerLocationNodes.head.entity.get(SectorFeaturesComponent);
			let sectorStatus = this.playerLocationNodes.head.entity.get(SectorStatusComponent);
			
			let efficiency = this.getCurrentScavengeEfficiency();
			let investigatedPercentBefore = sectorStatus.getInvestigatedPercent();
			let weightedInvestigateAdded = Math.min(1, efficiency);
			let investigatePercentAfter = sectorStatus.getInvestigatedPercent(weightedInvestigateAdded);
			let isCompletion = investigatePercentAfter >= 100;
			
			let playerPos = this.playerLocationNodes.head.position;
			let campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			
			log.i("getInvestigateRewards | isCompletion: " + isCompletion, this);
			
			if (isCompletion) {
				let possibleCompletionRewards = ItemConstants.getAvailableInsightCaches(campOrdinal);
	 			rewards.gainedItems = [ this.getSpecificRewardItem(1, possibleCompletionRewards) ];
			} else {
				let itemOptions = { rarityKey: "investigateRarity", allowNextCampOrdinal: isCompletion };
	 			rewards.gainedItems = this.getRewardItems(0.25, 0, [], itemOptions);
				rewards.gainedEvidence = 1;
			}
			
			return rewards;
		},

		getScoutRewards: function () {
			var rewards = new ResultVO("scout");
			rewards.gainedEvidence = 1;
			return rewards;
		},

		getScoutLocaleRewards: function (localeVO) {
			var rewards = new ResultVO("scout");
			var localeCategory = localeVO.getCategory();
			var playerPos = this.playerLocationNodes.head.position;
			var levelOrdinal = GameGlobals.gameState.getLevelOrdinal(playerPos.level);
			var campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);

			var availableResources = this.playerLocationNodes.head.entity.get(SectorFeaturesComponent).resourcesScavengable.clone();
			availableResources.addAll(localeVO.getResourceBonus(GameGlobals.gameState.getUnlockedResources(), campOrdinal), "scout-rewards");
			availableResources.limitAll(WorldConstants.resourcePrevalence.RARE, WorldConstants.resourcePrevalence.ABUNDANT, "scout-rewards");
			var efficiency = this.getCurrentScavengeEfficiency();
			var localeDifficulty = (localeVO.requirements.vision[0] + localeVO.costs.stamina / 10) / 100;

			// blueprints
			rewards.gainedBlueprintPiece = this.getResultBlueprint(localeVO);
			
			// tribe stats
			if (localeVO.type == localeTypes.grove) {
				rewards.gainedFavour = 2;
			} else if (localeVO.type == localeTypes.tradingpartner) {
			} else {
				rewards.gainedEvidence = ExplorationConstants.getScoutLocaleReward(localeVO.type, campOrdinal);
			}
			
			let followerID = localeVO.followerID;
			if (followerID) {
				rewards.gainedFollowers = [ FollowerConstants.getNewPredefinedFollower(followerID) ];
			} else {
				if (localeVO.type !== localeTypes.tradingpartner && localeVO.type != localeTypes.grove) {
					// population and followers
					if (localeCategory !== "u") {
						rewards.gainedFollowers = this.getRewardFollowers(0.075);
						if (rewards.gainedFollowers.length == 0 && this.nearestCampNodes.head && campOrdinal > 1) {
							rewards.gainedPopulation = Math.random() < 0.1 ? 1 : 0;
						}
					}
					
					// items and resources
					if (localeCategory === "u") {
						let itemOptions = { rarityKey: "localeRarity", allowNextCampOrdinal: true };
						rewards.gainedResources = this.getRewardResources(1, 5 * localeDifficulty, efficiency, availableResources);
						rewards.gainedItems = this.getRewardItems(0.5, 0.1, null, itemOptions);
					} else {
						let itemOptions = { rarityKey: "tradeRarity", allowNextCampOrdinal: true };
						rewards.gainedItems = this.getRewardItems(0.25, 0, null, itemOptions);
					}
				}
			}

			return rewards;
		},

		getUseSpringRewards: function () {
			var rewards = new ResultVO("use_spring");
			var bagComponent = this.playerResourcesNodes.head.entity.get(BagComponent);
			var water = Math.floor(Math.min(bagComponent.totalCapacity - bagComponent.usedCapacity, 30));
			rewards.gainedResources = new ResourcesVO(storageTypes.RESULT);
			rewards.gainedResources.water = water;
			return rewards;
		},

		getClearWorkshopRewards: function () {
			var rewards = new ResultVO("clear_workshop");
			return rewards;
		},

		getNapRewards: function () {
			var rewards = new ResultVO("nap");
			return rewards;
		},

		getFightRewards: function (won, enemyVO) {
			var rewards = new ResultVO("fight");
			if (won) {
				// TODO make fight rewards dependent on enemy difficulty (amount)
				let availableResources = this.getAvailableResourcesForEnemy(enemyVO);
				
				rewards.gainedResources = this.getRewardResources(0.5, 2, this.getCurrentScavengeEfficiency(), availableResources);
				rewards.gainedItems = this.getRewardItems(0, 1, enemyVO.droppedIngredients, {});
				rewards.gainedReputation = 1;
			} else {
				rewards = this.getFadeOutResults("fight", 0.5, 1, 0.75, 0.5, enemyVO);
			}
			return rewards;
		},

		getFadeOutResults: function (sourceAction, loseInventoryProbability, injuryProbability, loseAugmentationProbability, loseFollowerProbability, enemyVO) {
			log.i("get fade out results: loseInventoryProbability:" + loseInventoryProbability + ", injuryProbability:" + injuryProbability + ", loseAugmentationProbability:" + loseAugmentationProbability + ", loseFollowerProbability:" + loseFollowerProbability);
			let resultVO = new ResultVO("despair");
			if (Math.random() < loseInventoryProbability) {
				resultVO.lostResources = this.playerResourcesNodes.head.resources.resources.clone();
				resultVO.lostCurrency = this.playerResourcesNodes.head.entity.get(CurrencyComponent).currency;
				this.addLostAndBrokenItems(resultVO, "despair", 1, false)
			}
			resultVO.lostFollowers = this.getLostFollowers(loseFollowerProbability);
			
			resultVO.lostPerks = this.getLostPerks(loseAugmentationProbability);
			
			let finalInjuryProbability = resultVO.lostPerks.length > 0 ? injuryProbability / 2 : injuryProbability;
			resultVO.gainedInjuries = this.getResultInjuries(finalInjuryProbability, sourceAction, enemyVO);

			return resultVO;
		},

		getSectorsRevealedByMap: function (foundPosition) {
			// NOTE: This should be deterministic so you can't save scum
			let campSector = GameGlobals.levelHelper.getCampSectorOnLevel(foundPosition.level);
			let campPosition = campSector ? campSector.get(PositionComponent) : null;

			let entranceSector = GameGlobals.levelHelper.getEntranceSectorOnLevel(foundPosition.level);
			let entrancePosition = entranceSector ? entranceSector.get(PositionComponent) : null;

			let revealRadius = 3;

			let getCenterSectorScore = function (s) {
				let score = 0;
				
				let featuresComponent = s.get(SectorFeaturesComponent);
				let localesComponent = s.get(SectorLocalesComponent);
				let sectorPosition = s.get(PositionComponent);

				// most important: sector is POI
				if (!campSector && featuresComponent.campable) score += 30;
				if (localesComponent.locales.length > 0) score += 20;
				if (featuresComponent.itemsScavengeable.length > 0) score += 10;
				if (featuresComponent.hasSpring) score += 10;
				if (featuresComponent.isInvestigatable) score += 5;
				if (featuresComponent.resourcesCollectable.getTotal() > 0) score += 5;
				if (featuresComponent.resourcesCollectable.length > 0) score += 5;

				// second important: distance to found position, camp and entrance				
				let foundDistance = GameGlobals.levelHelper.getSimpleDistance(foundPosition, sectorPosition);
				score += foundDistance <= revealRadius * 2 ? 0 : foundDistance * (-3);
				if (campPosition) score += GameGlobals.levelHelper.getSimpleDistance(campPosition, sectorPosition);
				if (entrancePosition) score += GameGlobals.levelHelper.getSimpleDistance(entrancePosition, sectorPosition);

				// tie-breakers: small things
				switch (featuresComponent.zone) {
					case WorldConstants.ZONE_ENTRANCE: score += -1; break;
					case WorldConstants.ZONE_POI_1: score += 1; break;
					case WorldConstants.ZONE_POI_2: score += 1; break;
				}
				if (featuresComponent.sunlit) score += -1;
				score += Math.min(revealRadius * 3, GameGlobals.levelHelper.getSectorsAround(sectorPosition, revealRadius).length);

				return score;
			};

			let candidates = GameGlobals.levelHelper.getSectorsByLevel(foundPosition.level);

			candidates = candidates.sort((a, b) => getCenterSectorScore(b) - getCenterSectorScore(a));

			let centerSector = candidates[0];
			
			let centerPosition = centerSector.get(PositionComponent);
			let sectorsToReveal = GameGlobals.levelHelper.getSectorsAround(centerPosition, revealRadius);
			
			log.i("sectors revealed by map: center: " + centerPosition + " radius: " + revealRadius + ", num: " + sectorsToReveal.length, this);

			return sectorsToReveal;
		},
		
		saveDiscoveredGoods: function (rewards) {
			let result = {};
			
			var sectorStatus = this.playerLocationNodes.head.entity.get(SectorStatusComponent);
			var sectorFeatures = this.playerLocationNodes.head.entity.get(SectorFeaturesComponent);
			var sectorResources = sectorFeatures.resourcesScavengable;
			for (var key in resourceNames) {
				var name = resourceNames[key];
				var amount = rewards.gainedResources.getResource(name);
				var inSector = sectorResources.getResource(name) > 0;
				if (amount > 0 && inSector) {
					sectorStatus.addDiscoveredResource(name);
					if (!result.resources) result.resources = [];
					result.resources.push(name);
				}
			}
			let sectorItems = sectorFeatures.itemsScavengeable;
			for (let i = 0; i < rewards.gainedItems.length; i++) {
				let item = rewards.gainedItems[i];
				if (item.type == ItemConstants.itemTypes.ingredient) {
					if (sectorItems.indexOf(item.id) >= 0) {
						if (!sectorStatus.hasDiscoveredItem(item.id)) {
							sectorStatus.addDiscoveredItem(item.id);
							if (!result.items) result.items = [];
							result.items.push(item);
						}
					}
				}
			}
			
			return result;
		},
		
		preCollectRewards: function (rewards) {
			if (rewards.brokenItems) {
				for (let i = 0; i < rewards.brokenItems.length; i++) {
					rewards.brokenItems[i].broken = true;
					GameGlobals.gameState.increaseGameStatSimple("numItemsBroken");
				}
			}
		},

		collectRewards: function (isTakeAll, rewards, campSector) {
			if (rewards.collected) {
				log.w("trying to collect rewards twice: " + rewards.action);
				return false;
			}

			rewards.collected = true;

			if (rewards && rewards.action == "scavenge") {
				var excursionComponent = this.playerResourcesNodes.head.entity.get(ExcursionComponent);
				if (excursionComponent) {
					if (this.isSomethingUsefulResult(rewards)) {
						excursionComponent.numConsecutiveScavengeUseless = 0;
						excursionComponent.numConsecutiveScavengeUselessSameLocation = 0;
					} else {
						excursionComponent.numConsecutiveScavengeUseless++;
						excursionComponent.numConsecutiveScavengeUselessSameLocation++;
					}
				}
			}
			
			if (rewards == null || rewards.isEmpty()) {
				return true;
			}
			
			let sourceSector = this.playerLocationNodes.head.entity;
			
			if (rewards.foundStashVO) {
				let sectorStatus = sourceSector.get(SectorStatusComponent);
				sectorStatus.stashesFound++;
			}
			
			let defaultRewardCampNode = this.getDefaultRewardCampNode();
			var currentStorage = campSector ? GameGlobals.resourcesHelper.getCurrentCampStorage(campSector) : GameGlobals.resourcesHelper.getCurrentStorage();
			var playerPos = this.playerLocationNodes.head.position;
			let sourcePos = campSector ? campSector.get(PositionComponent) : playerPos;

			if (isTakeAll) {
				rewards.selectedItems = rewards.gainedItems;
				rewards.selectedResources = rewards.gainedResources;
				rewards.discardedItems = [];
				rewards.discardedResources = new ResourcesVO(storageTypes.RESULT);
			}

			currentStorage.addResources(rewards.selectedResources);
			currentStorage.substractResources(rewards.discardedResources);
			currentStorage.substractResources(rewards.lostResources);

			for (let key in resourceNames) {
				let name = resourceNames[key];
				let amount = rewards.selectedResources.getResource(name);
				if (amount > 0) {
					GameGlobals.gameState.increaseGameStatKeyed("amountResourcesFoundPerName", name, amount);
				}
			}

			let currencyComponent = this.playerStatsNodes.head.entity.get(CurrencyComponent);
			currencyComponent.currency += rewards.gainedCurrency;
			currencyComponent.currency -= rewards.lostCurrency;
			if (rewards.gainedCurrency > 0) {
				GameGlobals.playerActionFunctions.unlockFeature("currency");
				GameGlobals.gameState.increaseGameStatSimple("amountFoundCurrency", rewards.gainedCurrency);
			}

			let itemsComponent = this.playerStatsNodes.head.items;
			if (rewards.selectedItems) {
				for (let i = 0; i < rewards.selectedItems.length; i++) {
					let item = rewards.selectedItems[i];
					GameGlobals.playerHelper.addItem(item, sourcePos);
					GameGlobals.gameState.increaseGameStatKeyed("numItemsFoundPerId", item.id);
					GameGlobals.gameState.increaseGameStatList("uniqueItemsFound", item.id);
				}
			}
			
			let followersComponent = this.playerStatsNodes.head.followers;
			if (rewards.gainedFollowers && rewards.gainedFollowers.length > 0) {
				for (let i = 0; i < rewards.gainedFollowers.length; i++) {
					let follower = rewards.gainedFollowers[i];
					if (this.willGainedFollowerJoinParty(follower)) {
						followersComponent.addFollower(follower);
						followersComponent.setFollowerInParty(follower, true);
						GameGlobals.gameState.increaseGameStatSimple("numFollowersRecruited");
						GlobalSignals.followersChangedSignal.dispatch();
					} else if (defaultRewardCampNode) {
						defaultRewardCampNode.camp.pendingRecruits.push(follower);
					} else {
						log.w("no place to put reward follower!")
					}
				}
				GameGlobals.playerActionFunctions.unlockFeature("followers");
			}

			if (rewards.gainedBlueprintPiece) {
				this.tribeUpgradesNodes.head.upgrades.addNewBlueprintPiece(rewards.gainedBlueprintPiece);
				GameGlobals.playerActionFunctions.unlockFeature("blueprints");
				GameGlobals.gameState.increaseGameStatSimple("numBlueprintPiecesFound");
			}

			if (rewards.lostItems) {
				for (let i = 0; i < rewards.lostItems.length; i++) {
					itemsComponent.removeItem(rewards.lostItems[i], false);
					GameGlobals.gameState.increaseGameStatSimple("numItemsLost");
				}
			}
			
			if (rewards.brokenItems) {
				for (let i = 0; i < rewards.brokenItems.length; i++) {
					rewards.brokenItems[i].broken = true;
				}
			}

			if (rewards.lostFollowers) {
				for (let i = 0; i < rewards.lostFollowers.length; i++) {
					followersComponent.removeFollower(rewards.lostFollowers[i]);
					GameGlobals.gameState.increaseGameStatSimple("numFollowersLost");
				}
			}

			if (rewards.discardedItems) {
				for (let i = 0; i < rewards.discardedItems.length; i++) {
					itemsComponent.discardItem(rewards.discardedItems[i], false);
				}
			}

			if (rewards.gainedInjuries) {
				var perksComponent = this.playerStatsNodes.head.perks;
				for (let i = 0; i < rewards.gainedInjuries.length; i++) {
					perksComponent.addPerk(PerkConstants.getPerk(rewards.gainedInjuries[i].id));
				}
				GameGlobals.gameState.increaseGameStatSimple("numInjuriesReceived", rewards.gainedInjuries.length);
			}
			
			if (rewards.lostPerks) {
				var perksComponent = this.playerStatsNodes.head.perks;
				for (let i = 0; i < rewards.lostPerks.length; i++) {
					perksComponent.removePerkById(rewards.lostPerks[i].id);
				}
			}

			if (rewards.gainedPopulation > 0) {
				if (defaultRewardCampNode) {
					defaultRewardCampNode.camp.pendingPopulation += 1;
				} else {
					log.w("No reward camp found for reward population.");
				}
			}

			// TODO assign reputation to nearest camp

			if (rewards.gainedEvidence) {
				this.playerStatsNodes.head.evidence.value += rewards.gainedEvidence;
				GameGlobals.gameState.increaseGameStatKeyed("amountPlayerStatsFoundPerId", "evidence", rewards.gainedEvidence);
			}

			if (rewards.gainedRumours) {
				this.playerStatsNodes.head.rumours.value += rewards.gainedRumours;
				GameGlobals.gameState.increaseGameStatKeyed("amountPlayerStatsFoundPerId", "rumours", rewards.gainedRumours);
			}

			if (rewards.gainedFavour) {
				this.playerStatsNodes.head.entity.get(DeityComponent).favour += rewards.gainedFavour;
				GameGlobals.gameState.increaseGameStatKeyed("amountPlayerStatsFoundPerId", "favour", rewards.gainedFavour);
			}

			if (rewards.gainedInsight) {
				this.playerStatsNodes.head.insight.value += rewards.gainedInsight;
				GameGlobals.gameState.increaseGameStatKeyed("amountPlayerStatsFoundPerId", "insight", rewards.gainedInsight);
				GameGlobals.playerActionFunctions.unlockFeature("insight");
			}

			GlobalSignals.inventoryChangedSignal.dispatch();

			return true;
		},

		getRewardsMessageText: function (rewards, baseMsg, format) {
			let msg = this.getRewardsMessage(rewards, baseMsg, format);
			return TextConstants.createTextFromLogMessage(msg.msg, msg.replacements, msg.values);
		},

		getRewardsMessage: function (rewards, baseMsg, format) {
			if (!rewards) return null;

			baseMsg = baseMsg || "";
			format = format || this.RESULT_MGS_FORMAT_LOG;

			let msg = baseMsg;
			let replacements = [];
			let values = [];
			let foundSomething = rewards.gainedResources.getTotal() > 0;

			if (baseMsg.length > 0) baseMsg += " ";


			if (rewards.gainedResources.getTotal() > 0) {
				let resourceTemplate = TextConstants.getLogResourceText(rewards.gainedResources);

				if (format == this.RESULT_MGS_FORMAT_LOG) msg += "Gained ";
				if (format == this.RESULT_MSG_FORMAT_PREVIW) msg += "+";

				msg += resourceTemplate.msg;
				replacements = replacements.concat(resourceTemplate.replacements);
				values = values.concat(resourceTemplate.values);
			}

			if (rewards.gainedCurrency) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " currency");
				values.push(rewards.gainedCurrency);
			}

			if (rewards.selectedItems && rewards.selectedItems.length > 0) {
				msg += ", ";
				foundSomething = true;

				var loggedItems = {};
				for (let i = 0; i < rewards.selectedItems.length; i++) {
					var item = rewards.selectedItems[i];
					if (typeof loggedItems[item.id] === 'undefined') {
						msg += "$" + replacements.length + ", ";
						replacements.push("#" + replacements.length + " " + item.name.toLowerCase());
						values.push(1);
						loggedItems[item.id] = replacements.length - 1;
					} else {
						values[loggedItems[item.id]]++;
					}
				}
			}

			if (rewards.gainedFollowers && rewards.gainedFollowers.length > 0) {
				msg += ", ";
				foundSomething = true;
				for (let i = 0; i < rewards.gainedFollowers.length; i++) {
					var follower = rewards.gainedFollowers[i];
					msg += "$" + replacements.length + ", ";
					replacements.push("#" + replacements.length + " " + follower.name.toLowerCase());
					values.push(1);
				}
			}

			if (rewards.gainedEvidence) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " evidence");
				values.push(rewards.gainedEvidence);
			}
			
			if (rewards.gainedInsight) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " insight");
				values.push(rewards.gainedInsight);
			}

			if (rewards.gainedRumours) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " rumours");
				values.push(rewards.gainedRumours);
			}

			if (rewards.gainedFavour) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " favour");
				values.push(rewards.gainedFavour);
			}

			if (rewards.gainedBlueprintPiece) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " piece of forgotten technology");
				values.push(1);
			}

			if (rewards.gainedPopulation) {
				msg += ", ";
				foundSomething = true;
				msg += "$" + replacements.length + ", ";
				replacements.push("#" + replacements.length + " population");
				values.push(rewards.gainedPopulation);
			}

			if (foundSomething) {
				if (format == this.RESULT_MGS_FORMAT_LOG) {
					msg = TextConstants.sentencify(msg);
				} else {
					msg = msg.trim();
				}
			} else {
				msg = "Didn't find anything.";
			}

			// TODO more (varied?) messages for getting injured

			if (rewards.gainedInjuries.length > 0) {
				msg += " Got injured.";
			}
			
			if (rewards.lostPerks.length > 0) {
				msg += " Lost" + TextConstants.getListText(rewards.lostPerks.map(perkVO => perkVO.name));
			}

			return { msg: msg, replacements: replacements, values: values };
		},

		getRewardDiv: function (resultVO, isFight, forceShowInventoryManagement) {
			forceShowInventoryManagement = forceShowInventoryManagement || false;
			
			let itemsComponent = this.playerStatsNodes.head.items;
			let followersComponent = this.playerStatsNodes.head.followers;
			let hasBag = itemsComponent.getCurrentBonus(ItemConstants.itemBonusTypes.bag) > 0;
			let bagComponent = this.playerResourcesNodes.head.entity.get(BagComponent);
			let isInitialSelectionValid = bagComponent.usedCapacity <= bagComponent.totalCapacity;

			let div = "<div id='reward-div'>";
			
			if (resultVO.gainedResourcesFromFollowers.getTotal() > 0 || resultVO.gainedItemsFromFollowers.length > 0) {
				// assuming only followers of certain type find items
				let follower = followersComponent.getFollowerInPartyByType(FollowerConstants.followerType.SCAVENGER);
				let displayName = follower ? "<span class='hl-functionality'>" + follower.name + "</span>" : "Followers";
				
				let displayFinds = "";
				let totalResources = resultVO.gainedResourcesFromFollowers.getTotal();
				let totalItems = resultVO.gainedItemsFromFollowers.length;
				if (totalResources > 0 && totalItems == 0) {
					if (resultVO.gainedResourcesFromFollowers.isOnlySupplies()) {
						displayFinds = "some supplies";
					} else if (resultVO.gainedResourcesFromFollowers.isOneResource()) {
						displayFinds = "some " + resultVO.gainedResourcesFromFollowers.getNames()[0];
					} else {
						displayFinds = "some resources";
					}
				} else if (totalItems == 1 && totalResources == 0) {
					displayFinds = Text.addArticle(resultVO.gainedItemsFromFollowers[0].name);
				} else if (totalItems > 1 && totalResources == 0) {
					let uniqueNames = [];
					let uniqueTypes = [];
					for (let i = 0; i < resultVO.gainedItemsFromFollowers.length; i++) {
						let item = resultVO.gainedItemsFromFollowers[i];
						if (uniqueNames.indexOf(item.name) < 0) uniqueNames.push(item.name);
						if (uniqueTypes.indexOf(item.type) < 0) uniqueTypes.push(item.type);
					}
					if (uniqueNames.length == 1) {
						displayFinds = totalItems + " " + Text.pluralify(uniqueNames[0]);
					} else if (uniqueTypes.length == 1) {
						displayFinds = "some " + ItemConstants.getItemTypeDisplayName(uniqueTypes[0]);
					} else {
						displayFinds = "some items";
					}
				} else {
					displayFinds = "some things";
				}
				
				div += "<div>";
				div += displayName + " found " + displayFinds;
				div += "</div>";
			}
			
			if (resultVO.gainedFollowers && resultVO.gainedFollowers.length > 0) {
				for (let i = 0; i < resultVO.gainedFollowers.length; i++) {
					let follower = resultVO.gainedFollowers[i];
					let followerType = FollowerConstants.getFollowerTypeForAbilityType(follower.abilityType);
					let willJoin = this.willGainedFollowerJoinParty(follower);
					let followerCamp = this.getDefaultRewardCampNode();
					let pronoun = FollowerConstants.getPronoun(follower);
					let followerTypeName = FollowerConstants.getFollowerTypeDisplayName(followerType);
					div += "<div>"
					div += UIConstants.getFollowerDiv(follower, false, false, true);
					div += "<br/>";
					div += "Met <span class='hl-functionality'>" + Text.addArticle(followerTypeName) + "</span> called " + follower.name + ". ";
					
					if (willJoin) {
						div += Text.capitalize(pronoun) + " joined the party.";
					} else if (followerCamp) {
						div += Text.capitalize(pronoun) +" will meet you at " + followerCamp.camp.getName() + " on level " + followerCamp.position.level + ".";
					}
					div += "</div>";
				}
			}

			let gainedhtml = "";
			gainedhtml += "<ul class='resultlist resultlist-positive'>";
			if (resultVO.gainedEvidence) {
				gainedhtml += "<li>" + resultVO.gainedEvidence + " evidence</li>";
			}
			if (resultVO.gainedRumours) {
				gainedhtml += "<li>" + resultVO.gainedRumours + " rumours</li>";
			}
			if (resultVO.gainedFavour) {
				gainedhtml += "<li>" + resultVO.gainedFavour + " favour</li>";
			}
			if (resultVO.gainedInsight) {
				gainedhtml += "<li>" + resultVO.gainedInsight + " insight</li>";
			}
			if (resultVO.gainedPopulation) {
				gainedhtml += "<li>" + resultVO.gainedPopulation + " population</li>";
			}
			if (resultVO.gainedBlueprintPiece) {
				gainedhtml += UIConstants.getBlueprintPieceLI(resultVO.gainedBlueprintPiece);
			}
			if (resultVO.gainedCurrency) {
				gainedhtml += "<li>" + resultVO.gainedCurrency + " silver</li>";
			}

			gainedhtml += "</ul>";
			let hasGainedStuff = gainedhtml.indexOf("<li") > 0;
			if (hasGainedStuff || forceShowInventoryManagement) div += gainedhtml;

			let hasLostInventoryStuff = resultVO.lostResources.getTotal() > 0 || resultVO.lostItems.length > 0 || resultVO.lostCurrency > 0;
			let hasLostSomething = resultVO.lostResources.getTotal() > 0 || resultVO.lostItems.length > 0 || resultVO.lostCurrency > 0 || resultVO.brokenItems > 0 || resultVO.lostFollowers.length > 0 || resultVO.gainedInjuries.length > 0 || resultVO.lostPerks.length > 0;

			if (hasLostInventoryStuff) {
				var lostMsg = resultVO.lostItems.length > 1 ? "Lost some items." : resultVO.lostItems.length > 0 ? "Lost an item." : ""
				var losthtml = "<div id='resultlist-loststuff' class='infobox'>";
				var losthtml = "<div class='warning'>" + lostMsg + "</span>";
				losthtml += "<div id='resultlist-loststuff-lost' class='infobox inventorybox inventorybox-negative'>";
				losthtml += "<ul></ul>";
				losthtml += "</div>"
				losthtml += "</div>";
				div += losthtml;
			}
			
			if (resultVO.brokenItems.length > 0) {
				if (resultVO.brokenItems.length == 1) {
					div += "<p class='warning'>Broke an item (" + ItemConstants.getItemDisplayName(resultVO.brokenItems[0]) + ").</p>";
				} else {
					div += "<p class='warning'>Broke some items.</p>";
				}
			}

			if (resultVO.gainedResources.getTotal() > 0 || resultVO.gainedItems.length > 0 || !isInitialSelectionValid || forceShowInventoryManagement) {
				var baghtml = "<div id='resultlist-inventorymanagement' class='unselectable'>";

				baghtml += "<div id='resultlist-inventorymanagement-found' class='infobox inventorybox'>";
				baghtml += "<h4 class='hide-from-visual-layout'>Found</h4>";
				baghtml += "<ul></ul>";
				baghtml += "<p class='msg-empty p-meta'>" + (isFight ? "Nothing left of the opponent." : "Nothing left here.") + "</p>";
				baghtml += "</div>"

				baghtml += "<div id='resultlist-inventorymanagement-kept' class='infobox inventorybox'>";
				baghtml += "<h4 class='hide-from-visual-layout'>Bag</h4>";
				baghtml += "<ul></ul>";
				baghtml += "<p class='msg-empty p-meta'>Your " + (hasBag ? "bag is" : "pockets are") + " empty.</p>";
				baghtml += "</div>"

				baghtml += "<div id='inventory-popup-bar' class='progress-wrap progress centered' style='margin-top: 10px'><div class='progress-bar progress'/><span class='progress-label progress'>?/?</span></div>";
				baghtml += "</div>"
				div += baghtml;
			}

			hasGainedStuff = hasGainedStuff || resultVO.gainedResources.getTotal() > 0 || resultVO.gainedItems.length > 0 || resultVO.gainedFollowers.length > 0;
			
			if (!hasGainedStuff && !hasLostSomething && !forceShowInventoryManagement) {
				if (isFight) div += "<p class='p-meta'>Nothing left behind.</p>"
				else if (resultVO.action === "despair") div += "";
				else if (resultVO.action === "clear_workshop") div += "";
				else if (resultVO.action === "clear_waste_r") div += "";
				else if (resultVO.action === "clear_waste_t") div += "";
				else if (resultVO.hasCustomReward) div += "";
				else div += "<p class='p-meta'>Didn't find anything useful.</p>";
			}
			
			if (resultVO.lostFollowers && resultVO.lostFollowers.length > 0) {
				for (let i = 0; i < resultVO.lostFollowers.length; i++) {
					div += "<p class='warning'><span class='hl-functionality'>" + resultVO.lostFollowers[i].name + "</span> left.</p>";
				}
			}

			if (resultVO.gainedInjuries.length > 0) {
				div += "<p class='warning'>You got injured.</p>";
			}

			if (resultVO.lostPerks.length > 0) {
				div += "<p class='warning'>You lost " + TextConstants.getListText(resultVO.lostPerks.map(perkVO => perkVO.name)) + ".</p>";
			}

			if (resultVO.lostCurrency > 0) {
				div += "<p class='warning'>You lost " + resultVO.lostCurrency + " silver.</p>";
			}

			div += "</div>";
			return div;
		},

		getResultMessagesBeforeSelection: function (resultVO) {
			let messages = [];
			
			if (!resultVO) return messages;
			
			if (resultVO && resultVO.foundStashVO) {
				messages.push({ id: LogConstants.getUniqueID(), text: TextConstants.getFoundStashMessage(resultVO.foundStashVO), addToPopup: true, addToLog: false });
			}
			
			return messages;
		},
		
		getResultMessagesAfterSelection: function (resultVO) {
			let messages = [];
			let itemsComponent = this.playerStatsNodes.head.entity.get(ItemsComponent);
			
			if (!resultVO) return messages;
				
			if (resultVO.gainedBlueprintPiece) {
				if (!this.tribeUpgradesNodes.head.upgrades.hasUpgrade(resultVO.gainedBlueprintPiece)) {
					let blueprintVO = this.tribeUpgradesNodes.head.upgrades.getBlueprint(resultVO.gainedBlueprintPiece);
					if (blueprintVO.currentPieces === 1) {
						messages.push({ id: LogConstants.MSG_ID_FOUND_BLUEPRINT_FIRST, text: "Found a piece of forgotten technology.", addToPopup: true, addToLog: true });
					} else {
						messages.push({ id: LogConstants.MSG_ID_FOUND_BLUEPRINT_CONSECUTIVE, text: "Found another piece of a blueprint.", addToPopup: true, addToLog: true });
					}
				}
			}
	
			if (resultVO.selectedItems) {
				for (let i = 0; i < resultVO.selectedItems.length; i++) {
					var item = resultVO.selectedItems[i];
					if (itemsComponent.getCountById(item.id, true) === 1) {
						if (item.equippable && !item.equipped) continue;
						messages.push({ id: LogConstants.MSG_ID_FOUND_ITEM_FIRST, text: "Found " + Text.addArticle(item.name) + ".", addToPopup: true, addToLog: true });
					}
				}
			}
				
			if (resultVO.gainedFollowers && resultVO.gainedFollowers.length > 0) {
				messages.push({ id: LogConstants.getUniqueID(), text: "Met a new follower.", addToPopup: true, addToLog: true });
			}
	
			if (resultVO.lostItems && resultVO.lostItems.length > 0) {
				let messageTemplate = LogConstants.getLostItemMessage(resultVO);
				let text = TextConstants.createTextFromLogMessage(messageTemplate.msg, messageTemplate.replacements, messageTemplate.values);
				messages.push({ id: LogConstants.MSG_ID_LOST_ITEM, text: text, addToPopup: true, addToLog: true });
			}
	
			if (resultVO.brokenItems && resultVO.brokenItems.length > 0) {
				let messageTemplate = LogConstants.getBrokeItemMessage(resultVO);
				let text = TextConstants.createTextFromLogMessage(messageTemplate.msg, messageTemplate.replacements, messageTemplate.values);
				messages.push({ id: LogConstants.MSG_ID_BROKE_ITEM, text: text, addToPopup: true, addToLog: true });
			}
				
			if (resultVO.lostFollowers && resultVO.lostFollowers.length > 0) {
				messages.push({ id: LogConstants.MSG_ID_LOST_FOLLOWER, text: "Lost " + resultVO.lostFollowers.length + " followers.", addToPopup: true, addToLog: true });
			}

			if (resultVO.gainedInjuries.length > 0) {
				messages.push({ id: LogConstants.MSG_ID_GOT_INJURED, text: "Got injured.", addToPopup: true, addToLog: true });
			}

			if (resultVO.lostPerks.length > 0) {
				messages.push({ id: LogConstants.MSG_ID_GOT_INJURED, text: LogConstants.getLostPerksMessage(resultVO), addToPopup: true, addToLog: true });
			}

			return messages;
		},

		getCurrentScavengeEfficiency: function () {
			let factors = this.getCurrentScavengeEfficiencyFactors();
			let result = 1;
			for (let key in factors) {
				result = result * (factors[key] || 1);
			}
			return result;
		},
		
		getCurrentScavengeEfficiencyFactors: function () {
			let result = {};
			
			let playerVision = this.playerStatsNodes.head.vision.value || 0;
			result["vision"] = MathUtils.map(playerVision, 0, 150, 0, 1.5);

			let sectorStatus = this.playerLocationNodes.head.entity.get(SectorStatusComponent);
			let scavengedPercent = sectorStatus.getScavengedPercent();
			let notScavengedPercent = MathUtils.map(scavengedPercent, 0, 100, 1, 0);
			result["sector"] = MathUtils.clamp(notScavengedPercent, 0.05, 1);
				
			return result;
		},

		// probabilityFactor (action-specific): base chance to get any resources at all (0-1)
		// amountFactor (action-specific): relative amount of resources found if found any, where regular scavenge is 1
		// efficiency: 0-1 current scavenge efficiency of the player, affects chance to find something and amount found
		// available resources: name -> relative amount depending on sector, affects both chance and amount (WorldConstants.resourcePrevalence)
		getRewardResources: function (probabilityFactor, amountFactor, efficiency, availableResources) {
			probabilityFactor = probabilityFactor || 0;
			amountFactor = amountFactor || 1;
			efficiency = efficiency || 1;
			
			var results = new ResourcesVO(storageTypes.RESULT);
			
			if (probabilityFactor == 0) return results;
			if (Math.random() > probabilityFactor) return results;
			if (!availableResources || !availableResources.getTotal || availableResources.getTotal() <= 0) return results;

			// select resources
			for (let key in resourceNames) {
				let name = resourceNames[key];
				let availableAmount = availableResources.getResource(name);
				if (availableAmount <= 0) continue;
					
				let baseProbability = this.getBaseResourceFindProbability(availableAmount);
				let finalProbability = MathUtils.clamp(baseProbability * efficiency, 0, 1);
				if (Math.random() > finalProbability) continue;
				
				let baseAmount = this.getBaseResourceFindAmount(name, availableAmount);
				let resultAmount = this.getFinalResourceFindAmount(name, baseAmount, efficiency, Math.random());
				
				results.setResource(name, resultAmount, "reward");
			}
			
			// consolation prize: if found nothing (useful) at this point, add 1 resource every few tries
			if (!this.isSomethingUsefulResources(results) && !GameGlobals.gameState.isAutoPlaying) {
				let excursionComponent = this.playerResourcesNodes.head.entity.get(ExcursionComponent);
				if (excursionComponent && excursionComponent.numConsecutiveScavengeUselessSameLocation > 0) {
					let highestResources = availableResources.getResourcesWithHighestAmount();
					if (highestResources.length > 0) {
						let resourceName = highestResources[Math.floor(Math.random() * highestResources.length)];
						let resourceAmount = availableResources.getResource(resourceName);
						if (resourceAmount > WorldConstants.resourcePrevalence.RARE) {
							results.setResource(resourceName, 1, "reward-consolation");
						}
					}
				}
			}

			return results;
		},

		getRewardCurrency: function (efficiency) {
			var campCount = GameGlobals.gameState.numCamps;
			var sectorFeatures = this.playerLocationNodes.head.entity.get(SectorFeaturesComponent);
			
			if (campCount < 2)
				return 0;
				
			if (efficiency < 0.25)
				return 0;
				
			if (sectorFeatures.campable) {
				return 0;
			}
			
			var findProbability = 0;
			switch (sectorFeatures.sectorType) {
				case SectorConstants.SECTOR_TYPE_RESIDENTIAL:
				case SectorConstants.SECTOR_TYPE_PUBLIC:
					findProbability = 0.002;
					break;
				case SectorConstants.SECTOR_TYPE_COMMERCIAL:
					findProbability = 0.03;
					break;
			}

			if (Math.random() > findProbability * efficiency)
				return 0;
			
			let max = 1 + Math.round(campCount / 3);

			return Math.ceil(Math.random() * max);
		},

		// itemProbability: base probability of finding one item (0-1)
		// ingredientProbability: base probability of finding some ingredients (0-1)
		// availableIngredients: optional list of ingredients that can drop (if null, any can drop, but if empty, none found)
		// options: see getRwardItem
		getRewardItems: function (itemProbability, ingredientProbability, availableIngredients, options) {
			let currentItems = this.playerStatsNodes.head.items;
			let hasBag = currentItems.getCurrentBonus(ItemConstants.itemBonusTypes.bag) > 0;
			let hasCamp = GameGlobals.gameState.unlockedFeatures.camp;
			let hasCampHere = this.playerLocationNodes.head.entity.has(CampComponent);
			// TODO override for scout localea (sector scavenged % should not decrease efficiency for them)
			let efficiency = this.getCurrentScavengeEfficiency();
			
			var playerPos = this.playerLocationNodes.head.position;
			var levelOrdinal = GameGlobals.gameState.getLevelOrdinal(playerPos.level);
			var campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			var step = GameGlobals.levelHelper.getCampStep(playerPos);
			var levelComponent = GameGlobals.levelHelper.getLevelEntityForPosition(playerPos.level).get(LevelComponent);
			var isHardLevel = levelComponent.isHard;
			
			let hasDecentEfficiency = efficiency > 0.25;
			
			let result = [];
			
			// Regular items
			if (itemProbability > 0) {
				
				// - Neccessity items (map, bag) that the player should find quickly if missing
				let minNecessityItemProbability = hasCamp ? 0.15 : 0.35;
				let necessityItemProbability = MathUtils.clamp(itemProbability * 5, minNecessityItemProbability, 0.35);
				if (Math.random() < necessityItemProbability) {
					var necessityItem = this.getNecessityItem(currentItems, campOrdinal);
					if (necessityItem) result.push(necessityItem);
				}

				// - Normal items
				let itemProbabilityWithEfficiency = itemProbability * efficiency;
				if (Math.random() < itemProbabilityWithEfficiency && hasBag && hasDecentEfficiency && result.length == 0) {
					var item = this.getRewardItem(efficiency, campOrdinal, step, options);
					if (item) result.push(item);
				}
			}
			
			// Ingredients
			if (ingredientProbability > 0) {
				let ingredientProbabilityWithEfficiency = ingredientProbability / 2 + ingredientProbability / 2 * efficiency;
				let max = Math.floor(Math.random() * 3);
				let amount = Math.floor(Math.random() * efficiency * max) + 1;
				let addedIngredient = false;
				
				// . Necessity ingredient (stuff blocking the player from progressing)
				// TODO replace with something that's not random & is better communicated in-game
				if (hasCamp && !hasCampHere && hasDecentEfficiency) {
					var necessityIngredient = this.getNecessityIngredient(ingredientProbability);
					if (necessityIngredient != null) {
						for (let i = 0; i <= amount; i++) {
							result.push(necessityIngredient.clone());
						}
						addedIngredient = true;
					}
				}

				// - Normal ingredients
				if (!availableIngredients || availableIngredients.length > 0) {
					if (hasBag && hasCamp && !addedIngredient && Math.random() < ingredientProbabilityWithEfficiency) {
						let ingredient = GameGlobals.itemsHelper.getUsableIngredient(availableIngredients);
						for (let i = 0; i <= amount; i++) {
							result.push(ingredient.clone());
						}
						addedIngredient = true;
					}
				}
			}
			
			return result;
		},

		getRewardFollowers: function (probability) {
			var followers = [];
			
			var playerPos = this.playerLocationNodes.head.position;
			let campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			if (campOrdinal <= FollowerConstants.FIRST_FOLLOWER_CAMP_ORDINAL)
				return followers;
			
			if (Math.random() < probability) {
				var follower = FollowerConstants.getNewRandomFollower(FollowerConstants.followerSource.SCOUT, GameGlobals.gameState.numCamps, playerPos.level);
				followers.push(follower);
			}
			
			return followers;
		},

		// options
		// - rarityKey: context-specific key used to determine item rarity (scavengeRarity/localeRarity/tradeRarity/investigateRarity)
		// - allowNextCampOrdinal: include items that require next camp ordinal in the valid items (for high value rewards)
		getRewardItem: function (efficiency, campOrdinal, step, options) {
			let rarityKey = options.rarityKey || "scavengeRarity";
			let itemsComponent = this.playerStatsNodes.head.entity.get(ItemsComponent);
			let hasDeity = this.playerStatsNodes.head.entity.has(DeityComponent);
			
			// choose rarity and camp ordinal thresholds
			let maxPossibleRarity = Math.min(campOrdinal * 4, 10);
			let maxRarity = MathUtils.clamp(maxPossibleRarity * Math.random(), 2, 10);
			
			let maxCampOrdinalBonus = 0;
			if (step == WorldConstants.CAMP_STEP_END) maxCampOrdinalBonus++;
			if (options.allowNextCampOrdinal) maxCampOrdinalBonus++;
			let maxCampOrdinal = campOrdinal + maxCampOrdinalBonus;
			
			let getMaximumCampOrdinal = function (itemDefinition, isObsolete) {
				if (isObsolete) return itemDefinition.requiredCampOrdinal || 1;
				return itemDefinition.maximumCampOrdinal > 0 ? itemDefinition.maximumCampOrdinal : 100;
			};
			
			let isUseActionBlockedByProgress = function (itemDefinition) {
				let useActionName = "use_item_" + itemDefinition.id;
				let useActionReqs = GameGlobals.playerActionsHelper.getReqs(useActionName);
				if (!useActionReqs) return false;
				if (useActionReqs.deity && !hasDeity) return true;
				return false;
			}
			
			let isPlayerInventoryTooMany = function (itemDefinition) {
				if (itemDefinition.equippable) return false;
				if (itemDefinition.type == ItemConstants.itemTypes.ingredient) return false;
				if (itemDefinition.type == ItemConstants.itemTypes.exploration) return false;
				if (itemDefinition.type == ItemConstants.itemTypes.trade) return false;
				if (itemDefinition.type == ItemConstants.itemTypes.artefact) return false;
				let numOwned = itemsComponent.getCountByBaseId(ItemConstants.getBaseItemId(itemDefinition.id), true);
				return numOwned >= 5;
			}
			
			// list and score possible items
			var validItems = [];
			var itemScores = {};
			for (var type in ItemConstants.itemDefinitions) {
				if (type == ItemConstants.itemTypes.ingredient) continue;
				var isObsoletable = ItemConstants.isObsoletable(type);
				let itemList = ItemConstants.itemDefinitions[type];
				for (let i in itemList) {
					let itemDefinition = itemList[i];
					let isObsolete = GameGlobals.itemsHelper.isObsolete(itemDefinition, itemsComponent, false);
					let rarity = itemDefinition[rarityKey] || -1;
					
					if (rarity <= 0) continue;
					if (rarity > maxRarity) continue;
					
					if (itemDefinition.requiredCampOrdinal > maxCampOrdinal) continue;
					if (getMaximumCampOrdinal(itemDefinition, isObsolete) < campOrdinal) continue;
					if (isUseActionBlockedByProgress(itemDefinition)) continue;
					if (isPlayerInventoryTooMany(itemDefinition)) continue;
					
					validItems.push(itemDefinition);
					
					var score = 1;
					if (itemDefinition.requiredCampOrdinal && itemDefinition.requiredCampOrdinal >= campOrdinal)
						score = score + 2;
					if (itemDefinition.requiredCampOrdinal && itemDefinition.requiredCampOrdinal > campOrdinal)
						score = score + 2;
						
					if (itemDefinition.craftable)
						score = score - 2;
					if (itemDefinition.craftable && isObsoletable)
						score = score / 2;
					if (isObsolete)
						score = score / 2;
					
					itemScores[itemDefinition.id] = score;
				}
			}
			
			if (validItems.length === 0) {
				log.w("No valid reward items found for campOrdinal " + campOrdinal + ", step " + step);
				return null;
			}
			
			// sort by score
			validItems.sort(function (a, b) {
				return itemScores[b.id] - itemScores[a.id];
			});
			
			if (!GameGlobals.gameState.uiStatus.isHidden) {
				log.i("valid items: " + validItems.length + " (max rarity: " + maxRarity + "/" + maxPossibleRarity + ", camp ordinal: " + campOrdinal + "/" + maxCampOrdinal + ")")
				// log.i(validItems);
			}
			
			// pick one random valid item, higher score more likely but all possible
			var index = MathUtils.getWeightedRandom(0, validItems.length);
			var item = validItems[index];
			if (!GameGlobals.gameState.uiStatus.isHidden)
				log.i("- selected index " + index + "/" + validItems.length + ": "+ item.id);
			
			return item.clone();
		},
		
		getSpecificRewardItem: function (itemProbability, possibleItemIds) {
			if (!possibleItemIds || possibleItemIds.length === 0) {
				log.w("No valid reward items for getSpecificRewardItem");
				return null;
			}
			
			let index = MathUtils.getWeightedRandom(0, possibleItemIds.length);
			let itemID = possibleItemIds[index];
			let item = ItemConstants.getItemByID(itemID);
			if (!item) return null;
			return item.clone();
		},

		getNecessityItem: function (currentItems, campOrdinal) {
			// first bag
			if (GameGlobals.gameState.numCamps < 2) {
				let firstBag = ItemConstants.getBag(1);
				if (currentItems.getCurrentBonus(ItemConstants.itemBonusTypes.bag) < firstBag.getBaseBonus(ItemConstants.itemBonusTypes.bag)) {
					let res = this.playerResourcesNodes.head.resources;
					if (res.resources.getTotal() > 2) {
						return firstBag.clone();
					}
				}
			}

			// map
			if (!GameGlobals.gameState.isAutoPlaying) {
				let visitedSectors = GameGlobals.gameState.numVisitedSectors;
				let numSectorsRequiredForMap = 5;
				if (visitedSectors > numSectorsRequiredForMap && currentItems.getCountById("equipment_map", true) <= 0) {
					return ItemConstants.getItemByID("equipment_map");
				}
				
				let playerPos = this.playerLocationNodes.head.position;
				if (playerPos.level < WorldConstants.LEVEL_NUMBER_STASH_ADVANCED_MAP && currentItems.getCountById("equipment_map_2", true) <= 0) {
					return ItemConstants.getItemByID("equipment_map_2");
				}
			}

			// non-craftable level clothing
			if (!GameGlobals.gameState.isAutoPlaying) {
				var clothing = GameGlobals.itemsHelper.getScavengeNecessityClothing(campOrdinal, 1);
				for (let i = 0; i < clothing.length; i++) {
					if (currentItems.getCountById(clothing[i].id, true) <= 0) {
						return clothing[i];
					}
				}
			}

			return null;
		},
		
		getNecessityIngredient: function (ingredientProbability) {
			if (GameGlobals.gameState.isAutoPlaying) return null;
			
			var playerPos = this.playerLocationNodes.head.position;
			var campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			var step = GameGlobals.levelHelper.getCampStep(playerPos);
			var levelComponent = GameGlobals.levelHelper.getLevelEntityForPosition(playerPos.level).get(LevelComponent);
			var isHardLevel = levelComponent.isHard;
			
			let itemsComponent = this.playerStatsNodes.head.entity.get(ItemsComponent);
			let playerStamina = this.playerStatsNodes.head.stamina;
			let niCampOrdinal = campOrdinal;
			let niStep = step + 1;
			let niIsHardlevel = isHardLevel;
			if (step > WorldConstants.CAMP_STEP_END) {
				niCampOrdinal += 1;
				niStep = WorldConstants.CAMP_STEP_START;
				niIsHardlevel = false;
			}
			
			let neededIngredients = GameGlobals.itemsHelper.getNeededIngredients(niCampOrdinal, step, niIsHardlevel, itemsComponent, true);
			let neededIngredientsWithoutScavengingSpots = neededIngredients.filter(ingredient => !GameGlobals.levelHelper.hasUsableScavengingSpotsForItem(ingredient));
			if (neededIngredientsWithoutScavengingSpots.length > 0) {
				let neededIngredientProp = MathUtils.clamp(ingredientProbability * 10, 0.25, 0.5);
				let numAvailableGangs = GameGlobals.levelHelper.getNumAvailableGangs(campOrdinal, playerStamina, itemsComponent);
				if (numAvailableGangs <= 1 && Math.random() < neededIngredientProp) {
					let ingredient = neededIngredientsWithoutScavengingSpots[0];
					return ingredient;
				}
			}
			
			return null;
		},

		getFixedRewards: function (action) {
			if (action == "scavenge") {
				let numTimesScavenged = GameGlobals.gameState.stats.numTimesScavenged || 0;
				let fixedRewardsDef = this.fixedRewards[action][numTimesScavenged];
				return fixedRewardsDef || null;
			}
			return  null;
		},
		
		addFixedRewards: function (rewardsVO, fixedRewards, availableResources) {
			let efficiency = this.getCurrentScavengeEfficiency();
			
			log.i("applying fixed rewards", this);
			if (GameGlobals.logInfo) console.log(fixedRewards);
			
			this.addFixedRewardsResources(rewardsVO, fixedRewards, efficiency, availableResources);
			this.addFixedRewardsItems(rewardsVO, fixedRewards);
		},
		
		addFixedRewardsResources: function (rewardsVO, fixedRewards, efficiency, availableResources) {
			let results = new ResourcesVO(storageTypes.RESULT);
			for (let key in fixedRewards.resources) {
				let name = resourceNames[key];
				let availableAmount = availableResources.getResource(name);
				if (availableAmount <= 0) continue;
				
				let randomVal = fixedRewards.resources[key];
				let baseAmount = this.getBaseResourceFindAmount(name, availableAmount);
				let resultAmount = this.getFinalResourceFindAmount(name, baseAmount, efficiency, randomVal);
				
				results.setResource(name, resultAmount, "reward-fixed");
			}
			
			rewardsVO.gainedResources = results;
		},
		
		addFixedRewardsItems: function (rewardsVO, fixedRewards) {
			let efficiency = this.getCurrentScavengeEfficiency();
			
			var playerPos = this.playerLocationNodes.head.position;
			var levelOrdinal = GameGlobals.gameState.getLevelOrdinal(playerPos.level);
			var campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			var step = GameGlobals.levelHelper.getCampStep(playerPos);
			
			let result = [];
			
			for (let key in fixedRewards.items) {
				let num = fixedRewards.items[key] || 1;
				let itemVO = ItemConstants.getItemByID(key);
				if (itemVO) {
					for (let i = 0; i < num; i++) {
						result.push(itemVO.clone());
					}
				}
			}
			
			rewardsVO.gainedItems = result;
		},

		addStashes: function (rewardsVO, stashes, stashesFound) {
			if (!stashes || stashes.length <= stashesFound) return;
			var stashVO = stashes[stashesFound];
			if (!GameGlobals.gameState.uiStatus.isHidden)
				log.i("found stash: " + stashVO.stashType + " " + stashVO.itemID + " " + (stashesFound+1) + "/" + stashes.length);
			rewardsVO.foundStashVO = stashVO;
			switch (stashVO.stashType) {
				case ItemConstants.STASH_TYPE_ITEM:
					var item = ItemConstants.getItemByID(stashVO.itemID);
					if (item) {
						for (let i = 0; i < stashVO.amount; i++) {
							rewardsVO.gainedItems.push(item.clone());
						}
					}
					break;
				case ItemConstants.STASH_TYPE_SILVER:
					rewardsVO.gainedCurrency += stashVO.amount;
					break;
			}
		},
		
		addFollowerBonuses: function (rewards, sectorResources, sectorIngredients, itemOptions) {
			var efficiency = this.getCurrentScavengeEfficiency();
			
			let generalBonus = GameGlobals.playerHelper.getCurrentBonus(ItemConstants.itemBonusTypes.scavenge_general);
			let suppliesBonus = GameGlobals.playerHelper.getCurrentBonus(ItemConstants.itemBonusTypes.scavenge_supplies);
			let ingredientsBonus = GameGlobals.playerHelper.getCurrentBonus(ItemConstants.itemBonusTypes.scavenge_ingredients);
			
			// general (resources)
			let bonusResourceProb = generalBonus - 1;
			let bonusResources = this.getRewardResources(bonusResourceProb, 1, efficiency, sectorResources);
			rewards.gainedResourcesFromFollowers = bonusResources;
			rewards.gainedResources.addAll(bonusResources, "reward-follower-bonus");
			
			if (bonusResources.getTotal() > 0) {
				generalBonus = 0;
			}
			
			// supplies
			let bonusSuppliesProb = suppliesBonus - 1;
			let sectorSupplies = new ResourcesVO(storageTypes.RESULT);
			sectorSupplies.setResource(resourceNames.food, sectorResources.getResource(resourceNames.food), "reward-follower-bonus");
			sectorSupplies.setResource(resourceNames.water, sectorResources.getResource(resourceNames.water), "reward-follower-bonus");
			let bonusSupplies = this.getRewardResources(bonusSuppliesProb, 1, efficiency, sectorSupplies);
			rewards.gainedResourcesFromFollowers.addAll(bonusSupplies, "reward-follower-bonus");
			rewards.gainedResources.addAll(bonusSupplies, "reward-follower-bonus");
			
			// ingredients
			if (rewards.gainedItems.length == 0) {
				let bonusItemProb = generalBonus - 1;
				let bonusIngredientProb = generalBonus - 1 + ingredientsBonus - 1;
				let bonusItems = this.getRewardItems(bonusItemProb, bonusIngredientProb, sectorIngredients, itemOptions);
				rewards.gainedItemsFromFollowers = bonusItems;
				for (let i = 0; i < bonusItems.length; i++) {
					rewards.gainedItems.push(bonusItems[i]);
				}
			}
		},
		
		isSomethingUsefulResult: function (result) {
			return this.isSomethingUsefulResources(result.gainedResources)
				|| result.gainedItems.length > 0
				|| result.gainedCurrency > 0
				|| result.gainedFollowers.length > 0
				|| result.gainedBlueprintPiece
				|| result.gainedEvidence > 0
				|| result.gainedRumours > 0
				|| result.gainedFavour > 0
				|| result.gainedInsight > 0
				|| result.gainedReputation > 0
				|| result.gainedPopulation > 0;
		},
		
		isSomethingUsefulResources: function (resources) {
			if (resources.getTotal() === 0) {
				return false;
			}
			for (var key in resourceNames) {
				var name = resourceNames[key];
				var amount = resources.getResource(name);
				if (amount > 0) {
					switch (name) {
						case resourceNames.water:
						case resourceNames.food:
							if (GameGlobals.gameState.unlockedFeatures.camp) return true;
							break;
						default:
							return true;
					}
				}
			}
			return false;
		},

		isRewardItemTypeLocked: function (itemType) {
			if (itemType === ItemConstants.itemBonusTypes.light) {
				return !GameGlobals.gameState.unlockedFeatures.vision;
			}
			return false;
		},

		addLostAndBrokenItems: function (resultVO, action, probability, onlySingleItem) {
			if (Math.random() > probability) return;
			if (!GameGlobals.gameState.unlockedFeatures.camp) return;
			
			let lostItems = [];
			let brokenItems = [];
			
			let itemsComponent = this.playerStatsNodes.head.items;
			let playerItems = itemsComponent.getAll(false);

			if (playerItems.length <= 0) return;

			// make list with duplicates based on probabilities
			// ignore ingredients here, they're handled below
			let itemList = [];
			let numValidItems = 0;
			let weightSum = 0;
			for (let i = 0; i < playerItems.length; i++) {
				let item = playerItems[i];
				if (item.type == ItemConstants.itemTypes.ingredient) continue;
				let weight = this.getItemLoseOrBreakChanceWeight(action, item);
				if (weight <= 0) continue;
				let count = Math.round(weight * 2);
				for (let j = 0; j < count; j++) {
					itemList.push(item);
				}
				weightSum += weight;
				numValidItems++;
			}
			
			// pick n items from the list
			if (numValidItems > 0) {
				let weightAvg = weightSum / numValidItems;
				let numMaxLost = weightAvg * 2;
				let numItems = onlySingleItem ? 1 : Math.ceil(Math.random() * numMaxLost);
				numItems = Math.min(numValidItems, numItems);

				for (let i = 0; i < numItems; i++) {
					let itemi = Math.floor(Math.random() * itemList.length);
					let selectedItem = itemList[itemi];
					
					if (selectedItem.repairable && !selectedItem.broken && Math.random() < 0.9) {
						brokenItems.push(selectedItem);
					} else {
						lostItems.push(selectedItem);
					}
					
					let optionsToRemove = [];
					for (let j = 0; j < itemList.length; j++) {
						if (itemList[j] == selectedItem) {
							optionsToRemove.push(j);
						}
					}
					itemList.splice(optionsToRemove[0], optionsToRemove.length);
				}
			}
			
			// ingredients: lose all or nothing
			if (!onlySingleItem) {
				for (let i = 0; i < playerItems.length; i++) {
					var item = playerItems[i];
					if (item.type !== ItemConstants.itemTypes.ingredient) continue;
					lostItems.push(item);
				}
			}
			
			resultVO.lostItems = lostItems;
			resultVO.brokenItems = brokenItems;
		},

		getItemLoseOrBreakChanceWeight: function (action, item) {
			let baseItemId = ItemConstants.getBaseItemId(item.id);
			let result = 1;

			if (!ItemConstants.isUnselectable(item)) return 0;
			
			let campCount = GameGlobals.gameState.numCamps;
			switch (item.type) {
				case ItemConstants.itemTypes.uniqueEquipment:
				case ItemConstants.itemTypes.ingredient:
					result = 0;
					break;
				case ItemConstants.itemTypes.bag:
				case ItemConstants.itemTypes.light:
					result = campCount > 0 ? 2 : 0;
					break;
				case ItemConstants.itemTypes.clothing_over:
				case ItemConstants.itemTypes.clothing_upper:
				case ItemConstants.itemTypes.clothing_lower:
				case ItemConstants.itemTypes.clothing_head:
				case ItemConstants.itemTypes.clothing_hands:
				case ItemConstants.itemTypes.shoes:
					result = 3;
					break;
				case ItemConstants.itemTypes.weapon:
					result = 4;
					break;
				default:
					result = 5;
					break;
			}
			
			switch (baseItemId) {
				case "cache_insight":
					result = 0;
					break;
			}
			
			if (item.equipped) result = result / 2;
			if (item.broken) result = result / 2;
				
			return result;
		},
		
		getLostFollowers: function (loseProbability) {
			let lostFollowers = [];
			
			if (loseProbability <= 0)
				return lostFollowers;
			
			let playerFollowers = this.playerStatsNodes.head.followers.getParty();
			if (playerFollowers.length < 1)
				return lostFollowers;
				
			let fightFollowers = this.playerStatsNodes.head.followers.getFollowersByType(FollowerConstants.followerType.FIGHTER);
			let possibleToLoseFollowers = fightFollowers.length > 1 ? playerFollowers : playerFollowers.filter(follower => FollowerConstants.getFollowerTypeForAbilityType(follower.abilityType) != FollowerConstants.followerType.FIGHTER);
			
			if (possibleToLoseFollowers.length < 1)
				return lostFollowers;
				
			let loseOne = Math.random() < loseProbability;
			
			if (loseOne) {
				var index = Math.floor(possibleToLoseFollowers.length * Math.random());
				lostFollowers.push(possibleToLoseFollowers[index]);
			}
			
			return lostFollowers;
		},
		
		getLostPerks: function (loseAugmentationProbability) {
			let result = [];
			
			if (Math.random() > loseAugmentationProbability) {
				return result;
			}
			
			let perksComponent = this.playerStatsNodes.head.perks;
			let perkIDs = [ PerkConstants.perkIds.healthBonus3, PerkConstants.perkIds.healthBonus2, PerkConstants.perkIds.healthBonus1 ];
			
			for (let i = 0; i < perkIDs.length; i++) {
				let perk = perksComponent.getPerk(perkIDs[i]);
				if (!perk) continue;
				
				result.push(perk);
				return result;
			}
			
			return result;
		},

		getResultInjuries: function (injuryProbability, action, enemyVO) {
			let perksComponent = this.playerStatsNodes.head.perks;
			let result = [];

			let currentEffect = perksComponent.getTotalEffect(PerkConstants.perkTypes.injury);
			let injuries = perksComponent.getPerksByType(PerkConstants.perkTypes.injury);

			// limit possible injuries
			if (currentEffect < 0.35 || injuries.length >= 5)
				return result;

			if (injuryProbability * currentEffect > Math.random()) {
				let sectorFeatures = this.playerLocationNodes.head.entity.get(SectorFeaturesComponent);
				let allowedTypes = this.getAllowedInjuryTypes(action, enemyVO, sectorFeatures);
				
				let injury = PerkConstants.getRandomInjury(allowedTypes);
				result.push(injury.clone());
			}
			
			return result;
		},
		
		getAllowedInjuryTypes: function (action, enemyVO, sectorFeatures) {
			let result = [];
			
			if (!enemyVO || !enemyVO.causedInjuryTypes || enemyVO.causedInjuryTypes.length == 0) {
				result.push(PerkConstants.injuryType.BLUNT);
				result.push(PerkConstants.injuryType.SHARP);
				
				if (Math.random() < 0.5) {
					result.push(PerkConstants.injuryType.FIRE);
				}
				
				if (sectorFeatures.hazards.poison > 0 || sectorFeatures.hazards.radiation > 0 || sectorFeatures.sectorType == SectorConstants.SECTOR_TYPE_INDUSTRIAL) {
					result.push(PerkConstants.injuryType.CHEMICAL);
				}
			} else {
				result = enemyVO.causedInjuryTypes;
			}
			
			return result;
		},

		getResultBlueprint: function (localeVO) {
			if (!localeVO.hasBlueprints) return null;
			
			var playerPos = this.playerLocationNodes.head.position;
			var campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			let levelIndex = GameGlobals.gameState.getLevelIndex(playerPos.level);
			let maxLevelIndex = GameGlobals.gameState.getMaxLevelIndex(playerPos.level);
			var blueprintType = localeVO.isEarly ? UpgradeConstants.BLUEPRINT_BRACKET_EARLY : UpgradeConstants.BLUEPRINT_BRACKET_LATE;
			var levelBlueprints = UpgradeConstants.getBlueprintsByCampOrdinal(campOrdinal, blueprintType, levelIndex, maxLevelIndex);

			var upgradesComponent = this.tribeUpgradesNodes.head.upgrades;
			var blueprintsToFind = [];
			var blueprintPiecesToFind = 0;
			for (let i = 0; i < levelBlueprints.length; i++) {
				var blueprintId = levelBlueprints[i];
				if (!upgradesComponent.hasUpgrade(blueprintId) && !upgradesComponent.hasAvailableBlueprint(blueprintId)) {
					var blueprintVO = upgradesComponent.getBlueprint(blueprintId);
					var remainingPieces = blueprintVO ? blueprintVO.maxPieces - blueprintVO.currentPieces : UpgradeConstants.getMaxPiecesForBlueprint(blueprintId);
					if (remainingPieces > 0) {
						blueprintsToFind.push(blueprintId);
						blueprintPiecesToFind += remainingPieces;
					}
				}
			}
			
			var bracket = localeVO.getBracket();
			var unscoutedLocales = GameGlobals.levelHelper.getLevelLocales(playerPos.level, false, bracket, localeVO, true);
			var numUnscoutedLocales = unscoutedLocales.length + 1;
			var scoutedLocales = GameGlobals.levelHelper.getLevelLocales(playerPos.level, true, bracket, localeVO, true);
			var numScoutedLocales = scoutedLocales.length + 1 - numUnscoutedLocales;
			var findBlueprintProbability = blueprintPiecesToFind / numUnscoutedLocales;
			
			if (!GameGlobals.gameState.uiStatus.isHidden) {
				log.i("get result blueprint: " + blueprintType + " | pieces to find: " + blueprintPiecesToFind + " / unscouted locales: " + numUnscoutedLocales + " -> prob: " + Math.round(findBlueprintProbability*100)/100 + ", scouted locales: " + numScoutedLocales);
				log.i(levelBlueprints);
				log.i(blueprintsToFind);
			}

			var isFirstEver = playerPos.level == 13 && numScoutedLocales == 0;
			if (isFirstEver || Math.random() < findBlueprintProbability) {
				let i = Math.floor(Math.random() * blueprintsToFind.length);
				return blueprintsToFind[i];
			}

			return null;
		},
		
		getFallbackFollowers: function (probability) {
			let result = [];
			if (GameGlobals.gameState.isAutoPlaying) return result;
			
			let playerPos = this.playerLocationNodes.head.position;
			let campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			if (campOrdinal < FollowerConstants.FIRST_FOLLOWER_CAMP_ORDINAL) return result;
			
			let upgradeID = GameGlobals.upgradeEffectsHelper.getUpgradeToUnlockBuilding(improvementNames.inn);
			if (GameGlobals.tribeHelper.hasUpgrade(upgradeID)) return result;
			
			let fightFollowers = this.playerStatsNodes.head.followers.getFollowersByType(FollowerConstants.followerType.FIGHTER);
			if (fightFollowers.length > 0) return result;
				
			let nearestCampNode = this.nearestCampNodes.head;
			if (nearestCampNode == null) return result;
			if (nearestCampNode.camp.pendingRecruits.length > 0) return result;
				
			let level = GameGlobals.gameState.getLevelForCamp(FollowerConstants.FIRST_FOLLOWER_CAMP_ORDINAL);
			let unscoutedLocales = GameGlobals.levelHelper.getLevelLocales(level, false, LocaleConstants.LOCALE_BRACKET_EARLY, null, false).length;
			if (unscoutedLocales > 0) return result;
			
			if (Math.random() < probability) {
				let followerTemplate = FollowerConstants.predefinedFollowers[FollowerConstants.FIRST_FOLLOWER_CAMP_ORDINAL];
				let follower = FollowerConstants.getNewPredefinedFollower(followerTemplate.id);
				result.push(follower);
			}
			
			return result;
		},
		
		getFallbackBlueprint: function (probability) {
			if (GameGlobals.gameState.isAutoPlaying) return;
			var missedBlueprints = [];
			var playerPos = this.playerLocationNodes.head.position;
			var upgradesComponent = this.tribeUpgradesNodes.head.upgrades;
			var campOrdinal = GameGlobals.gameState.getCampOrdinal(playerPos.level);
			var levelOrdinal = GameGlobals.gameState.getLevelOrdinal(playerPos.level);
			for (let i = 1; i < levelOrdinal; i++) {
				var level = GameGlobals.gameState.getLevelForOrdinal(i);
				var allLocales = GameGlobals.levelHelper.getLevelLocales(level, true, null, true).length;
				var unscoutedLocales = GameGlobals.levelHelper.getLevelLocales(level, false, null, true).length;
				if (allLocales > 0 && unscoutedLocales === 0) {
					var c = GameGlobals.gameState.getCampOrdinal(level);
					var levelIndex = GameGlobals.gameState.getLevelIndex(level);
					let maxLevelIndex = GameGlobals.gameState.getMaxLevelIndex(playerPos.level);
					var levelBlueprints = UpgradeConstants.getBlueprintsByCampOrdinal(c, null, levelIndex, maxLevelIndex);
					for (let j = 0; j < levelBlueprints.length; j++) {
						var blueprintId = levelBlueprints[j];
						if (upgradesComponent.hasUpgrade(blueprintId)) continue;
						if (upgradesComponent.hasAvailableBlueprint(blueprintId)) continue;
						if (upgradesComponent.hasAllPieces(blueprintId)) continue;
						missedBlueprints.push(blueprintId);
					}
				}
			}
			
			if (missedBlueprints.length > 0) {
				log.w("Found missed blueprints: " + missedBlueprints.join(","));
				if (Math.random() < probability) {
					return missedBlueprints[0];
				}
			}
			return null;
		},

		getBaseResourceFindProbability: function (prevalence) {
			switch (prevalence) {
				// rare no matter what
				case WorldConstants.resourcePrevalence.RARE: return 0.1;
				// just below scavenge efficiency so with 100% you can still have misses
				case WorldConstants.resourcePrevalence.DEFAULT: return 0.85;
				// equals scavenge efficiency
				case WorldConstants.resourcePrevalence.COMMON: return 1;
				// not quite 100% chance with 50% scavenge efficiency
				case WorldConstants.resourcePrevalence.ABUNDANT: return 1.9;
			}
			log.w("unknown resource prevalence: " + prevalence);
			return 0;
		},
		
		getBaseResourceFindAmount: function (name, prevalence) {
			switch (prevalence) {
				case WorldConstants.resourcePrevalence.RARE:
					return 1;
				case WorldConstants.resourcePrevalence.DEFAULT:
					return 2;
				case WorldConstants.resourcePrevalence.COMMON:
					return 3;
				case WorldConstants.resourcePrevalence.ABUNDANT:
					return 5;
			}
			log.w("unknown resource prevalence: " + prevalence);
			return 0;
		},
		
		getFinalResourceFindAmount: function (name, baseAmount, efficiency, random) {
			let resMin = 1;
			let resMax = 10;
			let minRandomAmoutFactor = 1/3*2;
			let maxRandomAmountFactor  = 1/3*4;
			
			let randomAmountFactor  = MathUtils.map(Math.random(), 0, 1, minRandomAmoutFactor, maxRandomAmountFactor);
			let resultAmount = baseAmount * efficiency * randomAmountFactor;
			resultAmount = Math.round(resultAmount);
			resultAmount = MathUtils.clamp(resultAmount, resMin, resMax);
			return resultAmount;
		},

		getAvailableResourcesForEnemy: function (enemyVO) {
			let result = new ResourcesVO(storageTypes.DEFINITION);
			for (let i = 0; i < enemyVO.droppedResources.length; i++) {
				result.setResource(enemyVO.droppedResources[i], WorldConstants.resourcePrevalence.COMMON, "definition");
			}
			return result;
		},
		
		getDefaultRewardCampNode: function () {
			let nearestCampNode = this.nearestCampNodes.head;
			if (nearestCampNode) return nearestCampNode;
			let lastVisitedCampNode = this.lastVisitedCampNodes.head;
			if (lastVisitedCampNode) return lastVisitedCampNode;
			return null;
		},

		willGainedFollowerJoinParty: function (follower) {
			let followersComponent = this.playerStatsNodes.head.followers;
			let followerType = FollowerConstants.getFollowerTypeForAbilityType(follower.abilityType);
			let existingInParty = followersComponent.getFollowerInPartyByType(followerType);
			if (existingInParty) return false;
			let existingRecruited = followersComponent.getAll();
			let maxFollowers = GameGlobals.campHelper.getCurrentMaxFollowersRecruited();
			if (existingRecruited.length >= maxFollowers) return false;
			return true;
		},

	});

	return PlayerActionResultsHelper;
});
