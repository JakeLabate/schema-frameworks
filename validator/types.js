// A compact slice of the schema.org type hierarchy: enough to know that a Dentist is a
// LocalBusiness, a TechArticle is an Article, and a Corporation is an Organization.
// Unknown types are never treated as wrong; they simply don't match a family.

const TREE = {
  Thing: ['Action', 'CreativeWork', 'Event', 'Intangible', 'Organization', 'Person', 'Place', 'Product', 'MedicalEntity'],
  CreativeWork: ['Article', 'Blog', 'Book', 'Clip', 'Comment', 'Course', 'Dataset', 'DigitalDocument', 'Game', 'HowTo', 'LearningResource', 'MediaObject', 'Movie', 'MusicRecording', 'Photograph', 'Question', 'Answer', 'Quiz', 'Recipe', 'Review', 'SoftwareApplication', 'SoftwareSourceCode', 'TVSeries', 'WebPage', 'WebPageElement', 'WebSite', 'Claim', 'CreativeWorkSeries', 'Guide', 'MathSolver', 'SpecialAnnouncement', 'Message', 'Collection', 'DefinedTermSet', 'Chapter', 'Episode', 'Map', 'Poster', 'Thesis', 'VisualArtwork'],
  Article: ['NewsArticle', 'BlogPosting', 'TechArticle', 'ScholarlyArticle', 'Report', 'SatiricalArticle', 'AdvertiserContentArticle', 'SocialMediaPosting'],
  NewsArticle: ['AnalysisNewsArticle', 'AskPublicNewsArticle', 'BackgroundNewsArticle', 'OpinionNewsArticle', 'ReportageNewsArticle', 'ReviewNewsArticle'],
  BlogPosting: ['LiveBlogPosting'],
  SocialMediaPosting: ['DiscussionForumPosting', 'BlogPosting'],
  TechArticle: ['APIReference'],
  ScholarlyArticle: ['MedicalScholarlyArticle'],
  Comment: ['CorrectionComment'],
  Review: ['ClaimReview', 'CriticReview', 'EmployerReview', 'MediaReview', 'Recommendation', 'UserReview'],
  MediaObject: ['AudioObject', 'ImageObject', 'VideoObject', 'TextObject', 'DataDownload', '3DModel', 'MusicVideoObject'],
  ImageObject: ['Barcode', 'ImageObjectSnapshot'],
  WebPage: ['AboutPage', 'CheckoutPage', 'CollectionPage', 'ContactPage', 'FAQPage', 'ItemPage', 'MedicalWebPage', 'ProfilePage', 'QAPage', 'RealEstateListing', 'SearchResultsPage'],
  CollectionPage: ['MediaGallery'],
  MediaGallery: ['ImageGallery', 'VideoGallery'],
  SoftwareApplication: ['MobileApplication', 'WebApplication', 'VideoGame'],
  Clip: ['MovieClip', 'TVClip', 'VideoGameClip'],
  Event: ['BusinessEvent', 'ChildrensEvent', 'ComedyEvent', 'CourseInstance', 'DanceEvent', 'DeliveryEvent', 'EducationEvent', 'EventSeries', 'ExhibitionEvent', 'Festival', 'FoodEvent', 'Hackathon', 'LiteraryEvent', 'MusicEvent', 'PublicationEvent', 'SaleEvent', 'ScreeningEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent', 'VisualArtsEvent'],
  PublicationEvent: ['BroadcastEvent', 'OnDemandEvent'],
  Organization: ['Airline', 'Consortium', 'Corporation', 'EducationalOrganization', 'FundingScheme', 'GovernmentOrganization', 'LibrarySystem', 'LocalBusiness', 'MedicalOrganization', 'NGO', 'NewsMediaOrganization', 'OnlineBusiness', 'PerformingGroup', 'PoliticalParty', 'Project', 'ResearchOrganization', 'SearchRescueOrganization', 'SportsOrganization', 'WorkersUnion'],
  OnlineBusiness: ['OnlineStore'],
  EducationalOrganization: ['CollegeOrUniversity', 'ElementarySchool', 'HighSchool', 'MiddleSchool', 'Preschool', 'School'],
  MedicalOrganization: ['DiagnosticLab', 'VeterinaryCare'],
  PerformingGroup: ['DanceGroup', 'MusicGroup', 'TheaterGroup'],
  SportsOrganization: ['SportsTeam'],
  Project: ['FundingAgency', 'ResearchProject'],
  Place: ['Accommodation', 'AdministrativeArea', 'CivicStructure', 'LandmarksOrHistoricalBuildings', 'LocalBusiness', 'Residence', 'TouristAttraction', 'TouristDestination'],
  Accommodation: ['Apartment', 'CampingPitch', 'House', 'Room', 'Suite'],
  House: ['SingleFamilyResidence'],
  Room: ['HotelRoom', 'MeetingRoom'],
  LocalBusiness: ['AnimalShelter', 'ArchiveOrganization', 'AutomotiveBusiness', 'ChildCare', 'Dentist', 'DryCleaningOrLaundry', 'EmergencyService', 'EmploymentAgency', 'EntertainmentBusiness', 'FinancialService', 'FoodEstablishment', 'GovernmentOffice', 'HealthAndBeautyBusiness', 'HomeAndConstructionBusiness', 'InternetCafe', 'LegalService', 'Library', 'LodgingBusiness', 'MedicalBusiness', 'ProfessionalService', 'RadioStation', 'RealEstateAgent', 'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'SportsActivityLocation', 'Store', 'TelevisionStation', 'TouristInformationCenter', 'TravelAgency'],
  AutomotiveBusiness: ['AutoBodyShop', 'AutoDealer', 'AutoPartsStore', 'AutoRental', 'AutoRepair', 'AutoWash', 'GasStation', 'MotorcycleDealer', 'MotorcycleRepair'],
  EmergencyService: ['FireStation', 'Hospital', 'PoliceStation'],
  EntertainmentBusiness: ['AdultEntertainment', 'AmusementPark', 'ArtGallery', 'Casino', 'ComedyClub', 'MovieTheater', 'NightClub'],
  FinancialService: ['AccountingService', 'AutomatedTeller', 'BankOrCreditUnion', 'InsuranceAgency'],
  FoodEstablishment: ['Bakery', 'BarOrPub', 'Brewery', 'CafeOrCoffeeShop', 'Distillery', 'FastFoodRestaurant', 'IceCreamShop', 'Restaurant', 'Winery'],
  GovernmentOffice: ['PostOffice'],
  HealthAndBeautyBusiness: ['BeautySalon', 'DaySpa', 'HairSalon', 'HealthClub', 'NailSalon', 'TattooParlor'],
  HomeAndConstructionBusiness: ['Electrician', 'GeneralContractor', 'HVACBusiness', 'HousePainter', 'Locksmith', 'MovingCompany', 'Plumber', 'RoofingContractor'],
  LegalService: ['Attorney', 'Notary'],
  LodgingBusiness: ['BedAndBreakfast', 'Campground', 'Hostel', 'Hotel', 'Motel', 'Resort', 'VacationRental'],
  Resort: ['SkiResort'],
  MedicalBusiness: ['CommunityHealth', 'Dermatology', 'DietNutrition', 'Emergency', 'Geriatric', 'Gynecologic', 'MedicalClinic', 'Midwifery', 'Nursing', 'Obstetric', 'Oncologic', 'Optician', 'Optometric', 'Otolaryngologic', 'Pediatric', 'Pharmacy', 'Physician', 'Physiotherapy', 'PlasticSurgery', 'Podiatric', 'PrimaryCare', 'Psychiatric', 'PublicHealth'],
  SportsActivityLocation: ['BowlingAlley', 'ExerciseGym', 'GolfCourse', 'HealthClub', 'PublicSwimmingPool', 'SkiResort', 'SportsClub', 'StadiumOrArena', 'TennisComplex'],
  Store: ['AutoPartsStore', 'BikeStore', 'BookStore', 'ClothingStore', 'ComputerStore', 'ConvenienceStore', 'DepartmentStore', 'ElectronicsStore', 'Florist', 'FurnitureStore', 'GardenStore', 'GroceryStore', 'HardwareStore', 'HobbyShop', 'HomeGoodsStore', 'JewelryStore', 'LiquorStore', 'MensClothingStore', 'MobilePhoneStore', 'MovieRentalStore', 'MusicStore', 'OfficeEquipmentStore', 'OutletStore', 'PawnShop', 'PetStore', 'ShoeStore', 'SportingGoodsStore', 'TireShop', 'ToyStore', 'WholesaleStore'],
  Product: ['ProductGroup', 'IndividualProduct', 'ProductCollection', 'ProductModel', 'SomeProducts', 'Vehicle', 'DietarySupplement', 'Drug'],
  Vehicle: ['BusOrCoach', 'Car', 'Motorcycle', 'MotorizedBicycle'],
  Intangible: ['Audience', 'Brand', 'BroadcastChannel', 'DefinedTerm', 'Demand', 'EntryPoint', 'Grant', 'ItemList', 'JobPosting', 'Language', 'ListItem', 'MemberProgram', 'MemberProgramTier', 'MerchantReturnPolicy', 'Occupation', 'Offer', 'OfferShippingDetails', 'PropertyValue', 'Quantity', 'Rating', 'Service', 'ShippingService', 'StructuredValue', 'VirtualLocation', 'Certification', 'SpeakableSpecification'],
  ItemList: ['BreadcrumbList', 'HowToSection', 'HowToStep', 'OfferCatalog'],
  ListItem: ['HowToDirection', 'HowToItem', 'HowToSection', 'HowToStep', 'HowToTip'],
  HowToItem: ['HowToSupply', 'HowToTool'],
  Offer: ['AggregateOffer', 'OfferForLease', 'OfferForPurchase'],
  Rating: ['AggregateRating', 'EndorsementRating'],
  AggregateRating: ['EmployerAggregateRating'],
  StructuredValue: ['ContactPoint', 'GeoCoordinates', 'GeoShape', 'InteractionCounter', 'MonetaryAmount', 'OpeningHoursSpecification', 'PriceSpecification', 'PropertyValue', 'QuantitativeValue', 'ShippingDeliveryTime', 'DefinedRegion', 'ShippingRateSettings', 'ShippingConditions', 'ServicePeriod', 'NutritionInformation', 'OwnershipInfo', 'RepaymentSpecification', 'TypeAndQuantityNode', 'WarrantyPromise', 'DatedMoneySpecification', 'MonetaryAmountDistribution', 'EngineSpecification', 'ExchangeRateSpecification'],
  ContactPoint: ['PostalAddress'],
  PriceSpecification: ['CompoundPriceSpecification', 'DeliveryChargeSpecification', 'PaymentChargeSpecification', 'UnitPriceSpecification'],
  MonetaryAmount: [],
  Action: ['AchieveAction', 'AssessAction', 'ConsumeAction', 'ControlAction', 'CreateAction', 'FindAction', 'InteractAction', 'MoveAction', 'OrganizeAction', 'PlayAction', 'SearchAction', 'SeekToAction', 'SolveMathAction', 'TradeAction', 'TransferAction', 'UpdateAction'],
  ConsumeAction: ['ReadAction', 'WatchAction', 'ListenAction', 'ViewAction'],
  TransferAction: ['BorrowAction'],
  InteractAction: ['FollowAction', 'BefriendAction', 'CommunicateAction', 'SubscribeAction'],
  AssessAction: ['ReactAction', 'ReviewAction'],
  ReactAction: ['LikeAction', 'DislikeAction'],
  CommunicateAction: ['CommentAction', 'ReplyAction', 'ShareAction', 'AskAction', 'InformAction'],
  CreateAction: ['WriteAction'],
  Person: ['Patient'],
};

const PARENTS = new Map();
for (const [parent, kids] of Object.entries(TREE)) {
  for (const k of kids) {
    if (!PARENTS.has(k)) PARENTS.set(k, new Set());
    PARENTS.get(k).add(parent);
  }
}
const KNOWN = new Set([...Object.keys(TREE), ...PARENTS.keys()]);

export const normType = (t) => String(t ?? '').replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/, '').trim();

export function typesOf(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const t = obj['@type'];
  if (t === undefined || t === null || t === '') return [];
  return (Array.isArray(t) ? t : [t]).map(normType).filter(Boolean);
}

const memo = new Map();
/** True when `type` is `target` or one of its schema.org descendants. */
export function isA(type, target) {
  type = normType(type);
  target = normType(target);
  if (type === target || target === 'Thing') return true;
  const key = `${type}>${target}`;
  if (memo.has(key)) return memo.get(key);
  let found = false;
  const seen = new Set();
  const stack = [type];
  while (stack.length && !found) {
    const t = stack.pop();
    for (const p of PARENTS.get(t) || []) {
      if (p === target) { found = true; break; }
      if (!seen.has(p)) { seen.add(p); stack.push(p); }
    }
  }
  memo.set(key, found);
  return found;
}

export const anyIsA = (types, target) => types.some((t) => isA(t, target));
export const isKnownType = (t) => KNOWN.has(normType(t));
