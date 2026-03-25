from pydantic import BaseModel, field_validator


class GenreCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()


class GenreResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
