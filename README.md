# Schema Frameworks

Tested JSON-LD builders for every Google rich result feature, in JavaScript and Python.

Each builder takes the data a page already has and returns schema.org markup that follows Google's documented rules, or returns nothing when a required value is missing or invalid. That is the point: markup Google would reject never ships.

Every builder here is explained, with its rules and a property reference, on [jakelabate.com/schema-frameworks](https://www.jakelabate.com/schema-frameworks/).

## What is in this repo

```
frameworks/<feature>/      one Google rich result feature
  <feature>-schema.js      JavaScript builder (browser or Node)
  <feature>_schema.py      Python builder, same output
  input.json               sample input
  output.jsonld            the output for that input
page-types/<page>/         whole pages: several features linked by @id
validator/                 the SchemaCDN rich result validator
test/                      test runners
```

## Use a builder

JavaScript, in the browser or Node:

```js
const { buildDatasetSchema } = require('./frameworks/dataset/dataset-schema.js');

const schema = buildDatasetSchema(pageData);
if (schema) {
  // <script type="application/ld+json"> + JSON.stringify(schema) + </script>
}
```

Python:

```python
from dataset_schema import build_dataset_schema

schema = build_dataset_schema(page_data)
```

Copy the file into your project, or read `input.json` to see the shape of data it expects. Each builder has no dependencies.

<!-- connector:start -->
## Use it in a chat

The builders are also offered to chat assistants as an MCP connector. Add this address to Claude, or to any assistant that supports MCP, and ask it to build markup for a page:

```
https://mcp.jakelabate.com/schema-frameworks/
```

It runs the builders in this repo, names the fields that stopped it when a page does not qualify, and links the page and the file behind every answer. No sign-in.

| Ask | What happens |
| --- | --- |
| "Which framework fits this page?" | It lists the 40 frameworks with what each one is for. |
| "What does Recipe markup need?" | It returns Google's rules, the checks the builder runs and every input field. |
| "Build Recipe schema for this page." | It runs the real builder on the page's data and checks the result against Google's rules. |
| "Why did it output nothing?" | It names the fields and the checks that stopped it. |
| "Give me the Python builder." | It returns the source with its file on GitHub. |
| "Is this JSON-LD valid?" | It checks any markup against Google's documented rules. |

[How to add it](https://www.jakelabate.com/schema-frameworks/#build-schema-in-a-chat)
<!-- connector:end -->

## Tests

```
npm test
```

For every folder this runs the JavaScript builder on `input.json` and checks the result matches `output.jsonld`, runs the Python builder and checks it produces the same output, and checks `output.jsonld` with the validator against Google's rules. GitHub runs the same tests on every push.

A few builders check dates in the data, such as an offer that has ended. Their tests run on the date recorded as `asOf` in `meta.json`, so an example gives the same answer every day.

## Frameworks (40)

| Feature | JavaScript | Python |
|---|---|---|
| [Article](https://www.jakelabate.com/schema-frameworks/article/) | [`article-schema.js`](frameworks/article/article-schema.js) | [`article_schema.py`](frameworks/article/article_schema.py) |
| [Book Actions](https://www.jakelabate.com/schema-frameworks/book/) | [`book-schema.js`](frameworks/book/book-schema.js) | [`book_schema.py`](frameworks/book/book_schema.py) |
| [Breadcrumb](https://www.jakelabate.com/schema-frameworks/breadcrumb/) | [`breadcrumb-schema.js`](frameworks/breadcrumb/breadcrumb-schema.js) | [`breadcrumb_schema.py`](frameworks/breadcrumb/breadcrumb_schema.py) |
| [Carousel](https://www.jakelabate.com/schema-frameworks/carousel/) | [`carousel-schema.js`](frameworks/carousel/carousel-schema.js) | [`carousel_schema.py`](frameworks/carousel/carousel_schema.py) |
| [Course](https://www.jakelabate.com/schema-frameworks/course/) | [`course-schema.js`](frameworks/course/course-schema.js) | [`course_schema.py`](frameworks/course/course_schema.py) |
| [Dataset](https://www.jakelabate.com/schema-frameworks/dataset/) | [`dataset-schema.js`](frameworks/dataset/dataset-schema.js) | [`dataset_schema.py`](frameworks/dataset/dataset_schema.py) |
| [Discussion Forum](https://www.jakelabate.com/schema-frameworks/discussion-forum/) | [`discussion-forum-schema.js`](frameworks/discussion-forum/discussion-forum-schema.js) | [`discussion_forum_schema.py`](frameworks/discussion-forum/discussion_forum_schema.py) |
| [Education Q&A](https://www.jakelabate.com/schema-frameworks/education-q-and-a/) | [`education-q-and-a-schema.js`](frameworks/education-q-and-a/education-q-and-a-schema.js) | [`education_q_and_a_schema.py`](frameworks/education-q-and-a/education_q_and_a_schema.py) |
| [Employer Aggregate Rating](https://www.jakelabate.com/schema-frameworks/employer-rating/) | [`employer-rating-schema.js`](frameworks/employer-rating/employer-rating-schema.js) | [`employer_rating_schema.py`](frameworks/employer-rating/employer_rating_schema.py) |
| [Estimated Salary](https://www.jakelabate.com/schema-frameworks/estimated-salary/) | [`estimated-salary-schema.js`](frameworks/estimated-salary/estimated-salary-schema.js) | [`estimated_salary_schema.py`](frameworks/estimated-salary/estimated_salary_schema.py) |
| [Event](https://www.jakelabate.com/schema-frameworks/event/) | [`event-schema.js`](frameworks/event/event-schema.js) | [`event_schema.py`](frameworks/event/event_schema.py) |
| [Fact Check](https://www.jakelabate.com/schema-frameworks/fact-check/) | [`fact-check-schema.js`](frameworks/fact-check/fact-check-schema.js) | [`fact_check_schema.py`](frameworks/fact-check/fact_check_schema.py) |
| [Home Activities](https://www.jakelabate.com/schema-frameworks/home-activities/) | [`home-activities-schema.js`](frameworks/home-activities/home-activities-schema.js) | [`home_activities_schema.py`](frameworks/home-activities/home_activities_schema.py) |
| [How-To](https://www.jakelabate.com/schema-frameworks/how-to/) | [`how-to-schema.js`](frameworks/how-to/how-to-schema.js) | [`how_to_schema.py`](frameworks/how-to/how_to_schema.py) |
| [Image Metadata](https://www.jakelabate.com/schema-frameworks/image-metadata/) | [`image-metadata-schema.js`](frameworks/image-metadata/image-metadata-schema.js) | [`image_metadata_schema.py`](frameworks/image-metadata/image_metadata_schema.py) |
| [Job Posting](https://www.jakelabate.com/schema-frameworks/job-posting/) | [`job-posting-schema.js`](frameworks/job-posting/job-posting-schema.js) | [`job_posting_schema.py`](frameworks/job-posting/job_posting_schema.py) |
| [Learning Video](https://www.jakelabate.com/schema-frameworks/learning-video/) | [`learning-video-schema.js`](frameworks/learning-video/learning-video-schema.js) | [`learning_video_schema.py`](frameworks/learning-video/learning_video_schema.py) |
| [Local Business](https://www.jakelabate.com/schema-frameworks/local-business/) | [`local-business-schema.js`](frameworks/local-business/local-business-schema.js) | [`local_business_schema.py`](frameworks/local-business/local_business_schema.py) |
| [Loyalty Program](https://www.jakelabate.com/schema-frameworks/loyalty-program/) | [`loyalty-program-schema.js`](frameworks/loyalty-program/loyalty-program-schema.js) | [`loyalty_program_schema.py`](frameworks/loyalty-program/loyalty_program_schema.py) |
| [Math Solvers](https://www.jakelabate.com/schema-frameworks/math-solvers/) | [`math-solvers-schema.js`](frameworks/math-solvers/math-solvers-schema.js) | [`math_solvers_schema.py`](frameworks/math-solvers/math_solvers_schema.py) |
| [Merchant Listing](https://www.jakelabate.com/schema-frameworks/merchant-listing/) | [`merchant-listing-schema.js`](frameworks/merchant-listing/merchant-listing-schema.js) | [`merchant_listing_schema.py`](frameworks/merchant-listing/merchant_listing_schema.py) |
| [Movie](https://www.jakelabate.com/schema-frameworks/movie/) | [`movie-schema.js`](frameworks/movie/movie-schema.js) | [`movie_schema.py`](frameworks/movie/movie_schema.py) |
| [Organization](https://www.jakelabate.com/schema-frameworks/organization/) | [`organization-schema.js`](frameworks/organization/organization-schema.js) | [`organization_schema.py`](frameworks/organization/organization_schema.py) |
| [Practice Problems](https://www.jakelabate.com/schema-frameworks/practice-problems/) | [`practice-problems-schema.js`](frameworks/practice-problems/practice-problems-schema.js) | [`practice_problems_schema.py`](frameworks/practice-problems/practice_problems_schema.py) |
| [Product Snippet](https://www.jakelabate.com/schema-frameworks/product-snippet/) | [`product-snippet-schema.js`](frameworks/product-snippet/product-snippet-schema.js) | [`product_snippet_schema.py`](frameworks/product-snippet/product_snippet_schema.py) |
| [Product Variants](https://www.jakelabate.com/schema-frameworks/product-variants/) | [`product-variants-schema.js`](frameworks/product-variants/product-variants-schema.js) | [`product_variants_schema.py`](frameworks/product-variants/product_variants_schema.py) |
| [Profile Page](https://www.jakelabate.com/schema-frameworks/profile-page/) | [`profile-page-schema.js`](frameworks/profile-page/profile-page-schema.js) | [`profile_page_schema.py`](frameworks/profile-page/profile_page_schema.py) |
| [Q&A](https://www.jakelabate.com/schema-frameworks/q-and-a/) | [`q-and-a-schema.js`](frameworks/q-and-a/q-and-a-schema.js) | [`q_and_a_schema.py`](frameworks/q-and-a/q_and_a_schema.py) |
| [Recipe](https://www.jakelabate.com/schema-frameworks/recipe/) | [`recipe-schema.js`](frameworks/recipe/recipe-schema.js) | [`recipe_schema.py`](frameworks/recipe/recipe_schema.py) |
| [Return Policy](https://www.jakelabate.com/schema-frameworks/return-policy/) | [`return-policy-schema.js`](frameworks/return-policy/return-policy-schema.js) | [`return_policy_schema.py`](frameworks/return-policy/return_policy_schema.py) |
| [Review Snippet](https://www.jakelabate.com/schema-frameworks/review-snippet/) | [`review-snippet-schema.js`](frameworks/review-snippet/review-snippet-schema.js) | [`review_snippet_schema.py`](frameworks/review-snippet/review_snippet_schema.py) |
| [Shipping Policy](https://www.jakelabate.com/schema-frameworks/shipping-policy/) | [`shipping-policy-schema.js`](frameworks/shipping-policy/shipping-policy-schema.js) | [`shipping_policy_schema.py`](frameworks/shipping-policy/shipping_policy_schema.py) |
| [Site Name](https://www.jakelabate.com/schema-frameworks/site-name/) | [`site-name-schema.js`](frameworks/site-name/site-name-schema.js) | [`site_name_schema.py`](frameworks/site-name/site_name_schema.py) |
| [Sitelinks Search Box](https://www.jakelabate.com/schema-frameworks/sitelinks-searchbox/) | [`sitelinks-searchbox-schema.js`](frameworks/sitelinks-searchbox/sitelinks-searchbox-schema.js) | [`sitelinks_searchbox_schema.py`](frameworks/sitelinks-searchbox/sitelinks_searchbox_schema.py) |
| [Software App (Beta)](https://www.jakelabate.com/schema-frameworks/software-app/) | [`software-app-schema.js`](frameworks/software-app/software-app-schema.js) | [`software_app_schema.py`](frameworks/software-app/software_app_schema.py) |
| [Speakable](https://www.jakelabate.com/schema-frameworks/speakable/) | [`speakable-schema.js`](frameworks/speakable/speakable-schema.js) | [`speakable_schema.py`](frameworks/speakable/speakable_schema.py) |
| [Subscription And Paywalled Content](https://www.jakelabate.com/schema-frameworks/subscription-paywalled-content/) | [`subscription-paywalled-content-schema.js`](frameworks/subscription-paywalled-content/subscription-paywalled-content-schema.js) | [`subscription_paywalled_content_schema.py`](frameworks/subscription-paywalled-content/subscription_paywalled_content_schema.py) |
| [Vacation Rental](https://www.jakelabate.com/schema-frameworks/vacation-rental/) | [`vacation-rental-schema.js`](frameworks/vacation-rental/vacation-rental-schema.js) | [`vacation_rental_schema.py`](frameworks/vacation-rental/vacation_rental_schema.py) |
| [Vehicle Listing](https://www.jakelabate.com/schema-frameworks/vehicle-listing/) | [`vehicle-listing-schema.js`](frameworks/vehicle-listing/vehicle-listing-schema.js) | [`vehicle_listing_schema.py`](frameworks/vehicle-listing/vehicle_listing_schema.py) |
| [Video](https://www.jakelabate.com/schema-frameworks/video/) | [`video-schema.js`](frameworks/video/video-schema.js) | [`video_schema.py`](frameworks/video/video_schema.py) |

## Page types

Real pages use several features at once. These build the whole connected graph for a kind of page; every page type links to the Organization and policies defined in `page-types/homepage`.

| Page type | JavaScript |
|---|---|
| [Homepage](https://www.jakelabate.com/schema-frameworks/page-types/homepage/) | [`homepage-page-schema.js`](page-types/homepage/homepage-page-schema.js) |
| [Product Page](https://www.jakelabate.com/schema-frameworks/page-types/product/) | [`product-page-schema.js`](page-types/product/product-page-schema.js) |
| [Article Page](https://www.jakelabate.com/schema-frameworks/page-types/article/) | [`article-page-schema.js`](page-types/article/article-page-schema.js) |
| [Local Business Page](https://www.jakelabate.com/schema-frameworks/page-types/local-business/) | [`local-business-page-schema.js`](page-types/local-business/local-business-page-schema.js) |
| [Recipe Page](https://www.jakelabate.com/schema-frameworks/page-types/recipe/) | [`recipe-page-schema.js`](page-types/recipe/recipe-page-schema.js) |
| [Job Posting Page](https://www.jakelabate.com/schema-frameworks/page-types/job-posting/) | [`job-posting-page-schema.js`](page-types/job-posting/job-posting-page-schema.js) |
| [Event Page](https://www.jakelabate.com/schema-frameworks/page-types/event/) | [`event-page-schema.js`](page-types/event/event-page-schema.js) |
| [Forum Thread Page](https://www.jakelabate.com/schema-frameworks/page-types/forum-thread/) | [`forum-thread-page-schema.js`](page-types/forum-thread/forum-thread-page-schema.js) |

## Prefer not to maintain markup yourself?

[SchemaCDN](https://www.jakelabate.com/products/schemacdn/) deploys and validates structured data across a site from one script tag, with no code release.

## Source and license

This repo is generated from [jakelabate.com](https://www.jakelabate.com/schema-frameworks/); fixes made there are published here. MIT licensed, by [Jake Labate](https://www.jakelabate.com/).
