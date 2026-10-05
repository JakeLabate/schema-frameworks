import re
from datetime import date, datetime, timezone

ISO_DATE_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?)?$")
ABSOLUTE_URL = re.compile(r"^https?://[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$", re.I)


def is_absolute_url(value):
    return isinstance(value, str) and bool(ABSOLUTE_URL.match(value))


# Returns the ISO 8601 string unchanged (timezone offset kept), or None if unparseable.
def to_iso_date_time(value):
    if not isinstance(value, str):
        return None
    text = value.strip()
    m = ISO_DATE_TIME.match(text)
    if not m:
        return None
    y, mo, d = int(m[1]), int(m[2]), int(m[3])
    try:
        date(y, mo, d)
    except ValueError:
        return None
    if int(m[4] or 0) > 23 or int(m[5] or 0) > 59 or int(m[6] or 0) > 59:
        return None
    return text


def to_iso_date(value):
    iso = to_iso_date_time(value)
    return iso[:10] if iso else None


# Drops None, "", [] and {} recursively.
def compact(value):
    if isinstance(value, list):
        items = [c for c in (compact(v) for v in value) if c is not None]
        return items or None
    if isinstance(value, dict):
        out = {k: c for k, c in ((k, compact(v)) for k, v in value.items()) if c is not None}
        return out or None
    return None if value is None or value == "" else value


def passes_page_gates(source):
    if source.get("indexable") is False:
        return False
    if source.get("canonicalUrl") and source.get("url") and source["canonicalUrl"] != source["url"]:
        return False
    return source.get("contentVisible") is not False


EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN", "VOLUNTEER", "PER_DIEM", "OTHER"]
SALARY_UNITS = ["HOUR", "DAY", "WEEK", "MONTH", "YEAR"]
CREDENTIAL_CATEGORIES = ["high school", "associate degree", "bachelor degree", "professional certificate", "postgraduate degree"]


def to_country_code(value):
    code = str(value or "").upper()
    return code if re.fullmatch(r"[A-Z]{2}", code) else None


def parse_instant(value):
    text = value.replace("Z", "+00:00") if "T" in value else value + "T00:00:00+00:00"
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def build_job_place(location):
    country = to_country_code(location.get("country"))
    if not country:
        return None  # addressCountry is required on every jobLocation
    return {
        "@type": "Place",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": location.get("street"),
            "addressLocality": location.get("locality"),
            "addressRegion": location.get("region"),
            "postalCode": location.get("postalCode"),
            "addressCountry": country,
        },
    }


def build_base_salary(salary):
    if not salary:
        return None
    currency = str(salary.get("currency") or "").upper()
    unit_text = str(salary.get("unit") or "").upper()
    if not re.fullmatch(r"[A-Z]{3}", currency) or unit_text not in SALARY_UNITS:
        return None
    value, low, high = salary.get("value"), salary.get("min"), salary.get("max")
    if value is None and (low is None or high is None or low > high):
        return None  # a value, or a valid range
    return {
        "@type": "MonetaryAmount",
        "currency": currency,
        "value": {
            "@type": "QuantitativeValue",
            "value": value,
            "minValue": low if value is None else None,
            "maxValue": high if value is None else None,
            "unitText": unit_text,
        },
    }


def build_job_posting_schema(source, now=None):
    now = now or datetime.now(timezone.utc)
    # (a) Page gates: indexable, self-canonical, a single job visible on this leaf page.
    if not passes_page_gates(source):
        return None

    # (b) Required: title, description (HTML, not the title), datePosted, hiringOrganization.
    date_posted = to_iso_date_time(source.get("datePosted"))
    org = source.get("hiringOrganization") or {}
    title, description = source.get("title"), source.get("descriptionHtml")
    if not title or not description or not date_posted or not org.get("name"):
        return None
    if description.strip() == title.strip():
        return None

    # Expired postings must not keep active markup.
    valid_through = to_iso_date_time(source.get("validThrough"))
    if valid_through and parse_instant(valid_through) < now:
        return None

    # Either-or: jobLocation, or applicantLocationRequirements for fully remote jobs.
    job_location = [p for p in (build_job_place(l) for l in source.get("locations") or []) if p]
    applicant_countries = [c for c in (to_country_code(v) for v in source.get("remoteEligibleCountries") or []) if c]
    is_remote = source.get("fullyRemote") is True
    if is_remote and not applicant_countries and not job_location:
        return None  # TELECOMMUTE needs a country
    if not is_remote and not job_location:
        return None

    months = source.get("monthsOfExperience")
    # (c) Required + recommended properties, only when the source has them.
    schema = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": title,
        "description": description,
        "datePosted": date_posted,
        "validThrough": valid_through,
        "hiringOrganization": {
            "@type": "Organization",
            "name": org["name"],
            "sameAs": org.get("url") if is_absolute_url(org.get("url")) else None,
            "logo": org.get("logo") if is_absolute_url(org.get("logo")) else None,
        },
        "jobLocation": job_location,
        "jobLocationType": "TELECOMMUTE" if is_remote else None,
        "applicantLocationRequirements": (
            [{"@type": "Country", "name": code} for code in applicant_countries] if is_remote else None
        ),
        # (d) Custom rules: enums, salary range, booleans.
        "employmentType": [t for t in source.get("employmentTypes") or [] if t in EMPLOYMENT_TYPES],
        "baseSalary": build_base_salary(source.get("salary")) if source.get("postedByEmployer") else None,
        "directApply": source.get("directApply") if isinstance(source.get("directApply"), bool) else None,
        "identifier": source.get("requisitionId") and {
            "@type": "PropertyValue",
            "name": org["name"],
            "value": str(source["requisitionId"]),
        },
        "educationRequirements": {
            "@type": "EducationalOccupationalCredential",
            "credentialCategory": source.get("education"),
        } if source.get("education") in CREDENTIAL_CATEGORIES else None,
        "experienceRequirements": {
            "@type": "OccupationalExperienceRequirements",
            "monthsOfExperience": months,
        } if isinstance(months, int) and not isinstance(months, bool) and months >= 0 else None,
        "experienceInPlaceOfEducation": (
            source.get("experienceInPlaceOfEducation")
            if isinstance(source.get("experienceInPlaceOfEducation"), bool) else None
        ),
    }

    # (e) Strip empty values.
    return compact(schema)
