// lib/data/careers.ts
//
// Suggestions for education and work. Only suggestions: a person can type
// anything that is not here, and the family's own entries are added to
// the suggestions as people fill things in.

export const EDUCATION_LEVELS = [
  "Primary school",
  "Secondary school",
  "Certificate",
  "Diploma",
  "Bachelor's degree",
  "Master's degree",
  "Doctorate (PhD)",
  "Professional qualification",
  "Other",
];

export const INSTITUTIONS = [
  // Public universities
  "University of Nairobi", "Kenyatta University", "Moi University", "Egerton University", "Jomo Kenyatta University of Agriculture and Technology (JKUAT)",
  "Maseno University", "Masinde Muliro University of Science and Technology", "Dedan Kimathi University of Technology", "Technical University of Kenya",
  "Technical University of Mombasa", "Multimedia University of Kenya", "Chuka University", "Karatina University", "Kisii University", "Laikipia University",
  "Meru University of Science and Technology", "South Eastern Kenya University", "Pwani University", "Jaramogi Oginga Odinga University of Science and Technology",
  "University of Eldoret", "Machakos University", "Kibabii University", "Murang'a University of Technology", "Taita Taveta University", "Embu University",
  "Garissa University", "Kirinyaga University", "Rongo University", "Co-operative University of Kenya", "Tom Mboya University", "Alupe University",
  "University of Kabianga", "Maasai Mara University", "Kenya Coast National Polytechnic", "Open University of Kenya",
  // Private universities
  "Strathmore University", "United States International University - Africa (USIU-Africa)", "Daystar University", "Mount Kenya University", "Kenya Methodist University",
  "Catholic University of Eastern Africa", "Africa Nazarene University", "KCA University", "Kabarak University", "Pan Africa Christian University", "Riara University",
  "Zetech University", "Scott Christian University", "Gretsa University", "Adventist University of Africa", "Management University of Africa",
  "Great Lakes University of Kisumu", "Aga Khan University", "University of Eastern Africa, Baraton", "Presbyterian University of East Africa", "St. Paul's University",
  "Umma University", "Inoorero University", "East African University", "Uzima University", "Lukenya University", "Amref International University",
  // Colleges and institutes
  "Kenya Medical Training College (KMTC)", "Kenya School of Law", "Kenya Institute of Management", "Kenya Utalii College", "Kenya Institute of Mass Communication",
  "Kenya Technical Trainers College", "Nairobi Technical Training Institute", "Kenya School of Government", "Kenya Institute of Surveying and Mapping",
  "Railway Training Institute", "Cooperative College of Kenya", "Kenya Water Institute", "Eldoret National Polytechnic", "Kisumu National Polytechnic",
  "Mombasa Technical Training Institute", "Rift Valley Technical Training Institute", "Sigalagala National Polytechnic", "Thika Technical Training Institute",
  // Outside Kenya (a few common ones)
  "Makerere University", "University of Dar es Salaam", "University of Cape Town", "University of the Witwatersrand", "University of Oxford", "University of Cambridge",
];

export const WORK_STATUSES = ["Employed", "Self-employed", "Business owner", "Student", "Intern or attachment", "Retired", "Not working yet"];

export const SECTORS = [
  "Education", "Health and medicine", "Finance and banking", "Insurance", "Agriculture", "Technology and ICT", "Engineering and construction", "Government and public service",
  "Manufacturing", "Retail and trade", "Transport and logistics", "Hospitality and tourism", "Media and communication", "Legal", "NGO and non-profit", "Energy and mining",
  "Real estate", "Security", "Arts and entertainment", "Religion and ministry", "Sports", "Consulting", "Other",
];

export const JOB_TITLES = [
  "Teacher", "Lecturer", "Head teacher", "Nurse", "Doctor", "Clinical officer", "Pharmacist", "Lab technician", "Dentist", "Public health officer",
  "Accountant", "Auditor", "Bank teller", "Relationship manager", "Loan officer", "Credit analyst", "Financial analyst", "Insurance agent", "Actuary",
  "Software developer", "Systems administrator", "Network engineer", "Data analyst", "IT support officer", "Web designer", "Product manager", "Cybersecurity analyst",
  "Civil engineer", "Mechanical engineer", "Electrical engineer", "Quantity surveyor", "Architect", "Land surveyor", "Technician", "Electrician", "Plumber", "Mason", "Welder",
  "Driver", "Pilot", "Flight attendant", "Logistics officer", "Clearing and forwarding agent", "Mechanic",
  "Farmer", "Agronomist", "Veterinary officer", "Fisherman", "Livestock keeper",
  "Lawyer", "Advocate", "Magistrate", "Paralegal", "Court clerk",
  "Police officer", "Soldier", "Prison officer", "Security guard", "Fire fighter",
  "Civil servant", "Administrator", "Clerk", "Secretary", "Receptionist", "Human resources officer", "Procurement officer", "Project manager", "Programme officer",
  "Sales representative", "Marketing officer", "Shop attendant", "Cashier", "Business owner", "Trader", "Hawker", "Boda boda rider", "Matatu driver",
  "Journalist", "Editor", "Presenter", "Photographer", "Graphic designer", "Musician", "Actor", "Writer",
  "Chef", "Waiter", "Hotel manager", "Tour guide", "Barber", "Hairdresser", "Tailor", "Cleaner", "House manager", "Caretaker",
  "Pastor", "Priest", "Church worker", "Social worker", "Counsellor", "Community health worker", "Researcher", "Economist", "Statistician", "Librarian",
  "Entrepreneur", "Consultant", "Student", "Intern",
];
